# Madrid Live — Real Madrid + LaLiga + Premier League + Champions League

Full-stack, deployable football tracker. The browser talks only to the local Express backend; the backend reads ESPN's public, undocumented soccer endpoints without an API key.

## Deploy on Render
1. Push this folder to a GitHub repository.
2. Create a Render Web Service from the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. No API key is required.

The service serves both the frontend and `/api/*`, so it can be deployed as one public website.

## Data source
ESPN public soccer endpoints are used for scoreboards, schedules and match summaries. They are unofficial/undocumented and may change. The backend normalizes the response and caches it briefly to reduce load.

## Local features
Predictions, player ratings, notes and personal stream links are stored in the visitor's browser via localStorage. Browser notifications are scheduled locally while the page is open.

## Calendar
The app creates an `.ics` season calendar for Real Madrid and also provides Google Calendar add links for individual fixtures. A true account-wide Google Calendar OAuth sync requires Google credentials and user consent, so it is not falsely presented as automatic account sync.
