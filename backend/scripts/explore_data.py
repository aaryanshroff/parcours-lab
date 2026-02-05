"""poetry run streamlit run scripts/explore_data.py"""

import pandas as pd
import streamlit as st
from pathlib import Path

# Config
ROOT_DIR = Path(__file__).parent.parent / "data"

st.set_page_config(layout="wide", page_title="Data Explorer")
st.title("📂 Data Explorer")

st.sidebar.header("Navigation")

# File Discovery
all_files = sorted([
    p.relative_to(ROOT_DIR)
    for p in ROOT_DIR.rglob("*")
    if p.suffix in {".csv", ".json"}
])

if not all_files:
    st.error(f"No data files found in {ROOT_DIR}")
    st.stop()

selected_file = st.sidebar.selectbox("File", all_files)
file_path = ROOT_DIR / selected_file

# Load Data
try:
    if file_path.suffix == ".csv":
        df = pd.read_csv(file_path)
    elif file_path.suffix == ".json":
        df = pd.read_json(file_path)
    elif file_path.suffix == ".parquet":
        df = pd.read_parquet(file_path)

    st.write(f"### `{selected_file}`")
    st.caption(f"{len(df):,} rows - {len(df.columns)} columns")

    st.data_editor(df, disabled=True)

except Exception as e:
    st.error(f"Error loading file: {e}")
