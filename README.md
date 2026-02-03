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

### Frontend
```bash
cd frontend
npm install
npm run dev
```
