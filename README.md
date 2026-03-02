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

### DB

```bash
npx supabase link
```

Create `backend/.env`:
```bash
OPENROUTER_API_KEY=shared_key
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