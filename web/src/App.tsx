import React, {
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  AlertCircle,
  ExternalLink,
  FileText,
  FlaskConical,
  Search,
  Sparkles,
  UploadCloud
} from "lucide-react";

type Stage = "idle" | "extracting" | "searching" | "scoring" | "done" | "error";

interface ScoredGrant {
  id: string;
  number?: string | null;
  title: string;
  agency_name?: string | null;
  open_date?: string | null;
  close_date?: string | null;
  opp_status?: string | null;
  match_score: number;
}

interface AnalysisResponse {
  keywords: string[];
  grants: ScoredGrant[];
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.toString() ?? "http://localhost:8000";

const stageLabels: Record<Stage, string> = {
  idle: "Ready",
  extracting: "Extracting Keywords...",
  searching: "Querying Databases...",
  scoring: "Scoring Matches...",
  done: "Completed",
  error: "An error occurred"
};

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [grants, setGrants] = useState<ScoredGrant[]>([]);
  const [requestStart, setRequestStart] = useState<number | null>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [completedDurationSeconds, setCompletedDurationSeconds] = useState<number | null>(
    null
  );

  const ESTIMATED_TOTAL_SECONDS = 12;

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const selected = event.target.files?.[0] ?? null;
      if (!selected) return;
      if (selected.type === "application/pdf" || selected.name.toLowerCase().endsWith(".pdf")) {
        setFile(selected);
        setError(null);
      } else {
        setError("Please upload a PDF file.");
      }
    },
    []
  );

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    if (!droppedFile) return;
    if (
      droppedFile.type === "application/pdf" ||
      droppedFile.name.toLowerCase().endsWith(".pdf")
    ) {
      setFile(droppedFile);
      setError(null);
    } else {
      setError("Please upload a PDF file.");
    }
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const getScoreColorClasses = useCallback((score: number): string => {
    if (score >= 80) return "bg-[#881124]/10 border-[#881124]/60 text-[#881124]";
    if (score >= 50) return "bg-amber-50 border-amber-400 text-amber-700";
    if (score > 0) return "bg-stone-100 border-stone-400 text-stone-600";
    return "bg-gray-100 border-gray-300 text-gray-500";
  }, []);

  const sortedGrants = useMemo(
    () => [...grants].sort((a, b) => b.match_score - a.match_score),
    [grants]
  );

  const hasResults = keywords.length > 0 || sortedGrants.length > 0;

  useEffect(() => {
    if (!isSubmitting || requestStart === null) return;
    const intervalId = window.setInterval(() => {
      const elapsedMs = Date.now() - requestStart;
      const remainingMs = Math.max(0, ESTIMATED_TOTAL_SECONDS * 1000 - elapsedMs);
      setEtaSeconds(Math.ceil(remainingMs / 1000));
    }, 500);
    return () => window.clearInterval(intervalId);
  }, [ESTIMATED_TOTAL_SECONDS, isSubmitting, requestStart]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!file) {
        setError("Please select a PDF CV to upload.");
        return;
      }

      setIsSubmitting(true);
      setStage("extracting");
      setError(null);
      setKeywords([]);
      setGrants([]);
      setCompletedDurationSeconds(null);

      const start = Date.now();
      setRequestStart(start);
      setEtaSeconds(ESTIMATED_TOTAL_SECONDS);

      window.setTimeout(() => {
        setStage((prev) => (prev === "extracting" ? "searching" : prev));
      }, 800);
      window.setTimeout(() => {
        setStage((prev) =>
          prev === "searching" || prev === "extracting" ? "scoring" : prev
        );
      }, 1600);

      try {
        const formData = new FormData();
        formData.append("file", file, file.name);

        const response = await fetch(`${API_BASE_URL}/analyze`, {
          method: "POST",
          body: formData
        });

        if (!response.ok) {
          let detailMessage = "Server error while analyzing CV.";
          try {
            const errBody = (await response.json()) as { detail?: string };
            if (errBody.detail) detailMessage = errBody.detail;
          } catch {
            detailMessage = "Server error while analyzing CV.";
          }
          throw new Error(detailMessage);
        }

        const data = (await response.json()) as AnalysisResponse;
        setKeywords(data.keywords ?? []);
        setGrants(data.grants ?? []);
        setStage("done");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unexpected error occurred.";
        setError(message);
        setStage("error");
      } finally {
        if (requestStart !== null) {
          const elapsedSeconds = (Date.now() - requestStart) / 1000;
          setCompletedDurationSeconds(elapsedSeconds);
        }
        setRequestStart(null);
        setEtaSeconds(null);
        setIsSubmitting(false);
      }
    },
    [file]
  );

  return (
    <div className="min-h-screen bg-[#f5f0eb] text-[#1a1a1a] antialiased font-sans">
      {/* Top UMass brand bar */}
      <div className="bg-[#881124] h-1.5 w-full" />

      {/* Header */}
      <header className="bg-white border-b-2 border-[#881124] shadow-sm">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {/* UMass wordmark block */}
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="UMass Amherst Logo"
                className="h-10 w-auto object-contain"
              />
              <div className="h-10 w-px bg-[#881124]/30" />
              <div className="flex flex-col leading-none">
                <span className="text-[#1a1a1a] font-bold text-sm sm:text-base tracking-tight">
                  Department of Chemistry
                </span>
                <span className="text-[#881124] font-medium text-[0.65rem] sm:text-xs tracking-wide">
                  Grant Intelligence Platform
                </span>
              </div>
            </div>
          </div>

          {/* Right badge */}
          <div className="flex items-center gap-2 rounded-lg border border-[#881124]/20 bg-[#881124]/5 px-3 py-2 text-xs text-[#881124]">
            <FlaskConical className="h-4 w-4 shrink-0" />
            <div className="flex flex-col text-left leading-tight">
              <span className="font-semibold text-[0.75rem] text-[#1a1a1a]">
                AI-Powered Grant Matching
              </span>
              <span className="text-[0.65rem] text-[#881124]/80">
                Gemini 2.5 · Grants.gov · Chemistry-focused
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Hero / intro strip */}
      <div className="bg-[#881124] text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Agentic Grant Scout
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-red-100 leading-relaxed">
              Upload your CV and let AI surface the most relevant federal and
              foundation funding opportunities from Grants.gov — ranked by
              chemistry research fit.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 text-xs text-red-100 bg-white/10 rounded-xl px-4 py-3 border border-white/20 backdrop-blur">
            <Sparkles className="h-4 w-4 text-white" />
            <span className="font-medium text-white">v1.0 · Internal Prototype</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8">
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">

          {/* ── LEFT COLUMN ── */}
          <div className="space-y-5">
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Drag & drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={[
                  "group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 transition-all duration-200",
                  isDragging
                    ? "border-[#881124] bg-[#881124]/5 shadow-[0_0_0_4px_rgba(136,17,36,0.12)]"
                    : "border-[#881124]/30 bg-white hover:border-[#881124] hover:bg-[#881124]/5"
                ].join(" ")}
              >
                <div className="flex flex-col items-center text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#881124]/8 border border-[#881124]/20 shadow-sm">
                    <FileText className="h-8 w-8 text-[#881124]" />
                  </div>
                  <h2 className="text-lg font-semibold text-[#1a1a1a] sm:text-xl">
                    Drop your CV / Résumé (PDF)
                  </h2>
                  <p className="mt-1.5 text-xs text-[#555] sm:text-sm">
                    Drag and drop or{" "}
                    <span className="font-semibold text-[#881124]">click to browse</span>.
                    Only PDF files are supported.
                  </p>

                  <input
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    id="cv-upload-input"
                    onChange={handleFileChange}
                  />

                  <label
                    htmlFor="cv-upload-input"
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#881124] bg-white px-4 py-2 text-xs font-semibold text-[#881124] transition hover:bg-[#881124] hover:text-white sm:text-sm cursor-pointer"
                  >
                    <UploadCloud className="h-4 w-4" />
                    {file ? "Change File" : "Select PDF"}
                  </label>

                  {file && (
                    <p className="mt-3 max-w-xs truncate text-xs text-[#881124] font-medium sm:max-w-sm">
                      Selected: <span className="underline underline-offset-2">{file.name}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Submit row */}
              <div className="flex flex-col gap-3 rounded-2xl border border-[#881124]/15 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 shadow-sm">
                <button
                  type="submit"
                  disabled={!file || isSubmitting}
                  className={[
                    "inline-flex items-center justify-center rounded-xl px-6 py-2.5 text-sm font-bold tracking-wide transition-all duration-150",
                    !file || isSubmitting
                      ? "cursor-not-allowed bg-[#881124]/30 text-[#881124]/50"
                      : "bg-[#881124] text-white shadow-md shadow-[#881124]/30 hover:bg-[#6b0d1b] hover:shadow-lg"
                  ].join(" ")}
                >
                  {isSubmitting ? (
                    <>
                      <span className="mr-2 inline-flex h-4 w-4 items-center justify-center">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      </span>
                      Analyzing CV...
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Run Grant Scout
                    </>
                  )}
                </button>

                <div className="flex items-center gap-3 text-xs text-[#444] sm:text-sm">
                  <div className={[
                    "flex h-8 w-8 items-center justify-center rounded-full border",
                    stage === "error"
                      ? "border-red-400 bg-red-50"
                      : "border-[#881124]/20 bg-[#881124]/5"
                  ].join(" ")}>
                    {stage === "error" ? (
                      <AlertCircle className="h-4 w-4 text-red-500" />
                    ) : (
                      <Search className="h-4 w-4 text-[#881124]" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-semibold text-[#1a1a1a]">
                      {stageLabels[stage]}
                    </span>
                    <span className="text-[11px] text-[#888] sm:text-xs">
                      Extracting keywords → querying Grants.gov → scoring matches
                    </span>
                    {isSubmitting && (
                      <span className="mt-0.5 text-[11px] text-[#881124]/80 sm:text-xs">
                        Estimated time: ~{etaSeconds !== null ? etaSeconds : ESTIMATED_TOTAL_SECONDS}s
                      </span>
                    )}
                    {!isSubmitting && completedDurationSeconds !== null && (
                      <span className="mt-0.5 text-[11px] text-[#888] sm:text-xs">
                        Completed in {completedDurationSeconds.toFixed(1)}s
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-700 sm:text-sm">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{error}</p>
                </div>
              )}
            </form>

            {/* How it works */}
            {!hasResults && !error && (
              <div className="rounded-2xl border border-[#881124]/15 bg-white px-5 py-4 text-xs text-[#444] sm:text-sm shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <FlaskConical className="h-4 w-4 text-[#881124]" />
                  <p className="font-semibold text-[#1a1a1a]">
                    How the Chemistry Grant Scout works
                  </p>
                </div>
                <ol className="space-y-2 pl-1">
                  {[
                    "Reads your PDF CV and extracts clean text.",
                    "Uses Gemini gemini-2.5-flash to identify 7–8 targeted chemistry research keywords.",
                    "Concurrently queries the Grants.gov search2 API for all keywords using asyncio and httpx.",
                    "Fetches full opportunity details (synopsis, funding categories, applicant types) per grant.",
                    "Sends enriched grant data back to Gemini, which computes a Match % against your chemistry background, then returns ranked results."
                  ].map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#881124] text-[10px] font-bold text-white mt-0.5">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN ── */}
          <div className="flex flex-col gap-5">

            {/* Keywords panel */}
            <div className="rounded-2xl border border-[#881124]/15 bg-white px-5 py-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#881124]" />
                  <h3 className="text-sm font-semibold text-[#1a1a1a] sm:text-base">
                    AI-Selected Search Keywords
                  </h3>
                </div>
                {keywords.length > 0 && (
                  <span className="text-[11px] text-[#888] sm:text-xs">
                    Optimized for Grants.gov search2
                  </span>
                )}
              </div>
              {keywords.length === 0 ? (
                <p className="text-xs text-[#888] sm:text-sm">
                  Keywords will appear here after analysis.
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {keywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#881124]/30 bg-[#881124]/8 px-3 py-1 text-xs font-medium text-[#881124]"
                    >
                      <Search className="h-3 w-3" />
                      {kw}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Grant results */}
            <div className="flex-1 rounded-2xl border border-[#881124]/15 bg-white p-4 sm:p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-2 border-b border-[#881124]/10 pb-3">
                <h3 className="text-sm font-semibold text-[#1a1a1a] sm:text-base">
                  Ranked Grant Opportunities
                </h3>
                <span className="text-[11px] text-[#888] sm:text-xs">
                  {sortedGrants.length > 0
                    ? `${sortedGrants.length} opportunities found`
                    : "No results yet"}
                </span>
              </div>

              {sortedGrants.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center rounded-xl border border-dashed border-[#881124]/20 bg-[#881124]/3 text-center text-xs text-[#888] sm:text-sm">
                  <FlaskConical className="h-8 w-8 text-[#881124]/30 mb-2" />
                  <p className="max-w-xs">
                    Upload your CV and run the scout to see grant matches
                    ranked by chemistry research fit.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {sortedGrants.map((grant) => (
                    <article
                      key={grant.id}
                      className="flex flex-col justify-between rounded-xl border border-[#881124]/15 bg-[#f9f5f2] p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[#881124]/40 hover:shadow-md"
                    >
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="line-clamp-2 text-sm font-semibold text-[#1a1a1a]">
                            {grant.title}
                          </h4>
                          {grant.agency_name && (
                            <p className="mt-1 text-xs font-medium text-[#555] truncate">
                              {grant.agency_name}
                            </p>
                          )}
                          {grant.number && (
                            <p className="mt-0.5 text-[11px] text-[#999]">
                              #{grant.number}
                            </p>
                          )}
                        </div>
                        {/* Match score badge */}
                        <div
                          className={[
                            "ml-2 inline-flex shrink-0 flex-col items-center justify-center rounded-full border px-3 py-2 text-center",
                            getScoreColorClasses(grant.match_score)
                          ].join(" ")}
                        >
                          <span className="text-[10px] font-bold uppercase tracking-wide">
                            Match
                          </span>
                          <span className="text-lg font-black leading-none">
                            {grant.match_score}%
                          </span>
                        </div>
                      </div>

                      <div className="mt-2 flex items-end justify-between gap-2 text-[11px] text-[#888]">
                        <div className="space-y-0.5">
                          {grant.open_date && <p>Open: {grant.open_date}</p>}
                          {grant.close_date && <p>Close: {grant.close_date}</p>}
                          {grant.opp_status && (
                            <p className="capitalize">
                              Status:{" "}
                              <span className={[
                                "font-medium",
                                grant.opp_status.toLowerCase() === "posted"
                                  ? "text-green-700"
                                  : "text-amber-700"
                              ].join(" ")}>
                                {grant.opp_status.toLowerCase()}
                              </span>
                            </p>
                          )}
                        </div>
                        <a
                          href={`https://www.grants.gov/search-results-detail/${encodeURIComponent(grant.id)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full border border-[#881124]/30 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#881124] transition hover:bg-[#881124] hover:text-white hover:border-[#881124]"
                        >
                          View Details
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>

        </section>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-[#881124]/15 bg-white py-5">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-[#888]">
          <span>
            © {new Date().getFullYear()} University of Massachusetts Amherst ·
            Department of Chemistry
          </span>
          <span className="text-[#881124]/60">
            Internal research tool · Powered by Gemini 2.5 &amp; Grants.gov
          </span>
        </div>
      </footer>

      {/* Bottom accent bar */}
      <div className="bg-[#881124] h-1.5 w-full" />
    </div>
  );
};

export default App;
