import os; os.environ["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"
import asyncio
import json
import logging
from io import BytesIO
from typing import Any, Dict, List, Optional, cast


import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from pypdf import PdfReader


load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agentic-grant-scout")

GEMINI_MODEL_ID = "gemini-2.5-flash"

_api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
if not _api_key:
    raise RuntimeError(
        "Missing GEMINI_API_KEY (or GOOGLE_API_KEY) environment variable for Gemini."
    )

_gemini_client = genai.Client(api_key=_api_key)

GRANTS_SEARCH_URL = "https://api.grants.gov/v1/api/search2"
FETCH_OPPORTUNITY_URL = "https://api.grants.gov/v1/api/fetchOpportunity"


class Grant(BaseModel):
    id: str
    number: Optional[str] = None
    title: str
    agency_name: Optional[str] = None
    open_date: Optional[str] = None
    close_date: Optional[str] = None
    opp_status: Optional[str] = None


class ScoredGrant(Grant):
    match_score: int


class AnalysisResponse(BaseModel):
    keywords: List[str]
    grants: List[ScoredGrant]


# Gemini Response Schemas
class KeywordResponse(BaseModel):
    keywords: List[str] = Field(description="List of 7 to 8 short keyword phrases")

class GrantScore(BaseModel):
    grant_id: str
    score: int = Field(description="Score from 0 to 100")

class ScoreResponse(BaseModel):
    scores: List[GrantScore]


app = FastAPI(title="Agentic Grant Scout API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def extract_text_from_pdf_bytes(data: bytes) -> str:
    reader = PdfReader(BytesIO(data))
    pages_text: List[str] = []

    for index, page in enumerate(reader.pages):
        try:
            page_text = page.extract_text()
            if page_text:
                pages_text.append(page_text)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to extract text from page %s: %s", index, exc)

    return "\n\n".join(pages_text)


async def extract_keywords(cv_text: str) -> List[str]:
    system_instruction = (
        "You are an expert research assistant helping to search grants on Grants.gov. "
        "Given a user's CV/resume, you will propose focused search keywords.\n\n"
        "Requirements:\n"
        "- Output 7 to 8 short keyword phrases.\n"
        "- Each keyword should be suitable for the 'keyword' field of the Grants.gov search2 API.\n"
    )

    prompt = (
        f"{system_instruction}\n\n"
        "Here is the user's CV/resume text:\n"
        "----------------------------------------\n"
        f"{cv_text}\n"
        "----------------------------------------\n"
    )

    response = await _gemini_client.aio.models.generate_content(
        model=GEMINI_MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=KeywordResponse,
            temperature=0.2,
        )
    )

    try:
        data = KeywordResponse.model_validate_json(response.text)
        keywords = data.keywords
    except Exception as exc:
        logger.error("Failed to parse keyword JSON from Gemini: %s. Response: %s", exc, response.text)
        raise RuntimeError("Gemini returned invalid structured output.") from exc

    deduped: List[str] = []
    seen: set[str] = set()
    for kw in keywords:
        key = kw.strip().lower()
        if not key:
            continue
        if key not in seen:
            seen.add(key)
            deduped.append(kw.strip())
        if len(deduped) >= 8:
            break

    if not deduped:
        raise RuntimeError("Gemini returned no usable keywords.")

    return deduped


async def score_grants_batch(cv_text: str, grants_payload: List[Dict[str, Any]]) -> Dict[str, int]:
    if not grants_payload:
        return {}
        
    system_instruction = (
        "You are an expert grant-matching assistant.\n"
        "Given a candidate's CV and a list of Grants.gov opportunities, "
        "you will estimate how well each opportunity matches the candidate.\n\n"
        "Scoring rules:\n"
        "- Return a score from 0 to 100 for each grant_id.\n"
        "- 0 means 'not relevant'; 100 means 'perfect fit'.\n"
        "- Use the candidate's background, skills, and research areas vs. the full grant information provided.\n"
    )

    prompt = (
        f"{system_instruction}\n\n"
        "Candidate CV / resume text:\n"
        "----------------------------------------\n"
        f"{cv_text}\n"
        "----------------------------------------\n\n"
        "Grants list (JSON):\n"
        "----------------------------------------\n"
        f"{json.dumps(grants_payload, ensure_ascii=False)}\n"
        "----------------------------------------\n"
    )

    response = await _gemini_client.aio.models.generate_content(
        model=GEMINI_MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ScoreResponse,
            temperature=0.2,
        )
    )

    try:
        data = ScoreResponse.model_validate_json(response.text)
    except Exception as exc:
        logger.error("Failed to parse scores JSON: %s. Response: %s", exc, response.text)
        raise RuntimeError("Gemini returned invalid structured output.") from exc

    scores: Dict[str, int] = {}
    for item in data.scores:
        scores[str(item.grant_id)] = item.score
        
    return scores


async def fetch_grants_for_keyword(
    client: httpx.AsyncClient, keyword: str
) -> List[Grant]:
    payload: Dict[str, Any] = {
        "rows": 20,
        "keyword": keyword,
        "oppStatuses": "forecasted|posted",
    }

    logger.info("Searching Grants.gov for keyword: %s", keyword)

    response = await client.post(
        GRANTS_SEARCH_URL,
        json=payload,
        timeout=20.0,
    )
    response.raise_for_status()
    data = response.json()

    opp_hits: List[Dict[str, Any]] = data.get("data", {}).get("oppHits", [])
    results: List[Grant] = []

    for hit in opp_hits:
        try:
            grant = Grant.model_validate({
                "id": str(hit.get("id")),
                "number": hit.get("number"),
                "title": hit.get("title") or "",
                "agency_name": hit.get("agencyName"),
                "open_date": hit.get("openDate"),
                "close_date": hit.get("closeDate"),
                "opp_status": hit.get("oppStatus"),
            })
            if grant.id and grant.title:
                results.append(grant)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to parse Grants.gov hit: %s", exc)

    return results


async def _fetch_opportunity_detail_for_grant(
    client: httpx.AsyncClient, grant: Grant
) -> Dict[str, Any]:
    detail_payload: Dict[str, Any] = {
        "id": grant.id,
        "number": grant.number,
        "title": grant.title,
        "agency_name": grant.agency_name,
        "open_date": grant.open_date,
        "close_date": grant.close_date,
        "opp_status": grant.opp_status,
    }

    try:
        opportunity_id = int(grant.id)
    except ValueError:
        return detail_payload

    try:
        resp = await client.post(
            FETCH_OPPORTUNITY_URL,
            json={"opportunityId": opportunity_id},
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json().get("data") or {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to fetch opportunity details for %s: %s", grant.id, exc)
        return detail_payload

    synopsis = (data.get("synopsis") or {}) if isinstance(data, dict) else {}

    detail_payload.update(
        {
            "synopsis": synopsis.get("synopsisDesc") or "",
            "funding_activity_categories": data.get("fundingActivityCategories") or [],
            "applicant_types": data.get("applicantTypes") or [],
            "funding_instruments": data.get("fundingInstruments") or [],
            "alns": data.get("alns") or [],
            "award_ceiling": synopsis.get("awardCeiling"),
            "award_floor": synopsis.get("awardFloor"),
            "agency_contact_name": synopsis.get("agencyContactName"),
            "agency_contact_email": synopsis.get("agencyContactEmail"),
        }
    )

    return detail_payload


async def build_grant_payloads_with_details(
    client: httpx.AsyncClient, all_grants: List[Grant]
) -> List[Dict[str, Any]]:
    if not all_grants:
        return []

    tasks = [_fetch_opportunity_detail_for_grant(client, g) for g in all_grants]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    grant_payloads: List[Dict[str, Any]] = []
    for grant, result in zip(all_grants, results, strict=False):
        if isinstance(result, Exception):
            logger.exception("Error in opportunity detail task for %s: %s", grant.id, result)
            grant_payloads.append(
                {
                    "id": grant.id,
                    "number": grant.number,
                    "title": grant.title,
                    "agency_name": grant.agency_name,
                    "open_date": grant.open_date,
                    "close_date": grant.close_date,
                    "opp_status": grant.opp_status,
                }
            )
        else:
            grant_payloads.append(cast(Dict[str, Any], result))

    return grant_payloads


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_cv(file: UploadFile = File(...)) -> JSONResponse:
    if not file.filename.lower().endswith(".pdf") and file.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported.",
        )

    try:
        pdf_bytes = await file.read()
        if not pdf_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        cv_text = extract_text_from_pdf_bytes(pdf_bytes)
        if not cv_text.strip():
            raise HTTPException(
                status_code=400,
                detail="Could not extract text from the PDF. Please upload a text-based CV.",
            )

        keywords = await extract_keywords(cv_text)

        async with httpx.AsyncClient() as http_client:
            tasks = [fetch_grants_for_keyword(http_client, kw) for kw in keywords]
            results_or_errors = await asyncio.gather(*tasks, return_exceptions=True)

            grant_by_id: Dict[str, Grant] = {}
            for result in results_or_errors:
                if isinstance(result, BaseException):
                    logger.exception("Error during Grants.gov search: %s", result)
                    continue
                for grant in cast(List[Grant], result):
                    grant_by_id[grant.id] = grant

            if not grant_by_id:
                response = AnalysisResponse.model_validate({"keywords": keywords, "grants": []})
                return JSONResponse(content=response.model_dump(), status_code=200)

            all_grants: List[Grant] = list(grant_by_id.values())

            # Limit to top 60 recent/relevant (we just pick 60 to bound the initial list)
            max_grants_for_initial_scoring = 60
            if len(all_grants) > max_grants_for_initial_scoring:
                import itertools
                all_grants = list(itertools.islice(all_grants, max_grants_for_initial_scoring))

            # STAGE 1: Basic Scoring (Title/Agency only) to filter down quickly
            bare_payloads = [
                {
                    "id": g.id,
                    "title": g.title,
                    "agency_name": g.agency_name,
                    "opp_status": g.opp_status
                }
                for g in all_grants
            ]
            stage1_scores = await score_grants_batch(cv_text, bare_payloads)
            
            # Sort and take top 15
            all_grants.sort(key=lambda g: stage1_scores.get(g.id, 0), reverse=True)
            import itertools
            top_candidates = list(itertools.islice(all_grants, 15))

            # STAGE 2: Detailed Scoring
            # Fetch details for ONLY the top 15 candidates
            detailed_payloads = await build_grant_payloads_with_details(http_client, top_candidates)
            
            # Re-score with full details
            stage2_scores = await score_grants_batch(cv_text, detailed_payloads)

        # Assemble final results based on Stage 2 scores
        scored_grants: List[ScoredGrant] = []
        for grant in top_candidates:
            score = stage2_scores.get(grant.id, 0)
            scored_grants.append(
                ScoredGrant.model_validate({
                    "id": grant.id,
                    "number": grant.number,
                    "title": grant.title,
                    "agency_name": grant.agency_name,
                    "open_date": grant.open_date,
                    "close_date": grant.close_date,
                    "opp_status": grant.opp_status,
                    "match_score": score,
                })
            )

        # Sort final results
        scored_grants.sort(key=lambda g: g.match_score, reverse=True)

        response = AnalysisResponse.model_validate({"keywords": keywords, "grants": scored_grants})
        return JSONResponse(content=response.model_dump(), status_code=200)

    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unhandled error in /analyze: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error") from exc


@app.get("/health")
async def health_check() -> Dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
