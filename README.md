
# Agentic Grant Search

Agentic Grant Scout is an AI-powered platform designed to match researchers with relevant federal and foundation funding opportunities from Grants.gov. By analyzing a user's CV/Résumé with the Gemini API, it extracts focused research keywords, queries the Grants.gov database, and scores the opportunities based on their fit with the researcher's background.

## Features

- **CV Analysis**: Upload a PDF of your CV, and the platform uses Gemini to extract targeted keywords (currently optimized for chemistry research).
- **Automated Search**: Concurrently queries the Grants.gov search API using the extracted keywords.
- **AI Matching**: Fetches full opportunity details and leverages Gemini to compute a Match Percentage against your background.
- **Ranked Results**: Displays the most relevant grant opportunities ranked by fit.

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS, Vite
- **Backend**: Python, FastAPI, Uvicorn
- **AI Integration**: Google GenAI API (Gemini 2.5 Flash)

## Setup Instructions

### Environment Variables

Before starting the backend, you need to provide your Google API key for Gemini. Create a `.env` file in the `api/` directory:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### Backend (FastAPI)

1. Navigate to the `api` directory:
   ```bash
   cd api
   ```
2. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the development server:
   ```bash
   python main.py
   # or
   uvicorn main:app --reload --port 8000
   ```
   The backend will start at `http://localhost:8000`.

### Frontend (React/Vite)

1. Navigate to the `web` directory:
   ```bash
   cd web
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
   The frontend will start at the address provided by Vite (typically `http://localhost:5173`).

## Usage

1. Open the frontend application in your browser.
2. Drag and drop your CV (PDF format) into the upload zone.
3. Click **Run Grant Scout**.
4. The system will extract keywords, search Grants.gov, and present you with a ranked list of matched grant opportunities. You can view full details on Grants.gov by clicking "View Details".
