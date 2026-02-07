from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import json
import os
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In Vercel, the root is the parent of /api
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(ROOT_DIR, "data.json")

class Section(BaseModel):
    id: str
    name: str
    file: str # Path or identifier
    type: str # 'intro', 'loop', 'outro'
    crossfade: bool = True

class Song(BaseModel):
    id: str
    name: str
    sections: List[Section]

class AppData(BaseModel):
    songs: List[Song]

def load_data():
    # If a temporary version exists (saved during this instance's life), use it
    TMP_DATA = "/tmp/data.json"
    if os.path.exists(TMP_DATA):
        with open(TMP_DATA, "r", encoding="utf-8") as f:
            return json.load(f)
            
    # Fallback to bundled data
    if not os.path.exists(DATA_FILE):
        return {"songs": []}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_data(data):
    # Vercel filesystem is read-only at /var/task.
    # We can only write to /tmp, which lasts only for the duration of the lambda instance.
    TMP_DATA = "/tmp/data.json"
    try:
        with open(TMP_DATA, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"Failed to save to /tmp: {e}")

@app.get("/api/songs")
def get_songs():
    return load_data()

@app.post("/api/songs")
def save_songs(data: AppData):
    save_data(data.model_dump())
    return {"status": "success", "message": "Note: Changes are stored in temporary memory on Vercel and will be reset periodically."}

@app.get("/api/pick-file")
def pick_file():
    return {"path": "", "message": "File picking is not supported on the web version. Please put files in sound/ or bayFM/ folder and enter path manually."}

@app.get("/audio")
def get_audio(path: str):
    # Security: check if path is within allowed directories
    # The path coming from data.json is now relative e.g. "./sound/in.wav"
    
    # Normalize path
    clean_path = path.replace("./", "")
    abs_path = os.path.join(ROOT_DIR, clean_path)
    
    # Simple check to stay within ROOT_DIR
    if not abs_path.startswith(ROOT_DIR):
         raise HTTPException(status_code=403, detail="Access denied")

    if os.path.exists(abs_path):
        return FileResponse(abs_path)
    raise HTTPException(status_code=404, detail="File not found: " + clean_path)

# For Vercel, we don't need app.mount or if __name__ == "__main__"
# if it's strictly serving the API.
