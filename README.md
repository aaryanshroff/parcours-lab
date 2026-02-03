# ParcoursLab

## Setup

### Backend
Requires [Poetry](https://python-poetry.org/docs/#installation):
```bash
cd backend
poetry config virtualenvs.in-project true  # for VS Code auto-detection
poetry install
eval $(poetry env activate)
```

Create `backend/.env`:
```bash
OPENROUTER_API_KEY=shared_key
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```
