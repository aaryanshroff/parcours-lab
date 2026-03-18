# ParcoursLab

## Setup

### Backend
Requires [Poetry](https://python-poetry.org/docs/#installing-with-the-official-installer):
```bash
cd backend
poetry config virtualenvs.in-project true  # for VS Code auto-detection
poetry install
eval $(poetry env activate)
```

Create `backend/.env` (ask @aaryanshroff for real OpenRouter key):
```bash
OPENROUTER_API_KEY=shared_key
SUPABASE_URL=https://yxyupkqmvrmrdbrtbwby.supabase.co
```

### DB

```bash
npx supabase link
```

## Run

### Full App

```bash
cd frontend
npm run dev:all
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd backend
poetry run flask run
```

### DB Migration
```bash
cd backend
npx supabase migration new <name>
npx supabase db push
```