"""poetry run streamlit run scripts/explore_data.py"""

import json
import pandas as pd
import streamlit as st
from pathlib import Path


def load_data_file(file_path: Path, selected_file_name: str = None) -> pd.DataFrame:
    if file_path.suffix == ".csv":
        return pd.read_csv(file_path)
    elif file_path.suffix == ".json":
        with open(file_path, 'r') as f:
            data = json.load(f)

        # Find all keys that contain lists of dicts (tabular data)
        valid_keys = [
            k for k, v in data.items()
            if isinstance(v, list) and v and isinstance(v[0], dict)
        ]

        if not valid_keys:
            raise ValueError(
                f"No tabular data found in {file_path.name}. "
                f"Expected a list of records (dicts), not primitives."
            )

        # Let user pick which key if multiple options
        if len(valid_keys) > 1:
            list_key = st.sidebar.selectbox(
                "JSON Data Key",
                options=valid_keys,
                key=f"json_key_{selected_file_name}"
            )
        else:
            list_key = valid_keys[0]

        return pd.DataFrame(data[list_key])
    else:
        raise ValueError(f"Unsupported file type: {file_path.suffix}")


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

# Load and Display Data
try:
    df = load_data_file(file_path, str(selected_file))

    st.write(f"### `{selected_file}`")
    st.caption(f"{len(df):,} rows - {len(df.columns)} columns")

    st.data_editor(df, disabled=True)

except Exception as e:
    st.error(f"Error loading file: {e}")
