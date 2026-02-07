from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
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

DATA_FILE = "data.json"

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
    if not os.path.exists(DATA_FILE):
        return {"songs": []}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

@app.get("/api/songs")
def get_songs():
    return load_data()

@app.post("/api/songs")
def save_songs(data: AppData):
    save_data(data.model_dump())
    return {"status": "success"}

@app.get("/api/pick-file")
def pick_file():
    import subprocess
    # Use AppleScript to pick a file and return its POSIX path with a clear marker.
    script = '''
    set theFile to (choose file with prompt "音声ファイルを選択してください" of type {"public.audio", "public.mp3", "com.apple.m4a-audio", "public.wav-audio"})
    return "PATH_RESULT:" & (POSIX path of theFile)
    '''
    try:
        process = subprocess.Popen(['osascript', '-e', script], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        stdout, stderr = process.communicate()
        
        # Look for our marker in the output
        for line in stdout.splitlines():
            if "PATH_RESULT:" in line:
                file_path = line.split("PATH_RESULT:")[1].strip()
                return {"path": file_path}
        return {"path": ""}
    except Exception as e:
        return {"path": ""}

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
def index():
    index_path = os.path.join("static", "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Index.html not found</h1>"

# For serving local audio files directly if they are outside static
# Note: In a real local app, we might need a way to access files.
# For now, let's assume files are accessible via /audio?path=...
@app.get("/audio")
def get_audio(path: str):
    if os.path.exists(path):
        return FileResponse(path)
    raise HTTPException(status_code=404, detail="File not found")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
