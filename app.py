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

DATA_FILE_NAME = "data.json"
SETTINGS_FILE = "settings.json" # App settings like last project folder

def get_settings():
    if not os.path.exists(SETTINGS_FILE):
        return {"project_folder": ""}
    with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except:
            return {"project_folder": ""}

def save_settings(settings):
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=4)

def get_data_path():
    settings = get_settings()
    folder = settings.get("project_folder")
    if folder and os.path.exists(folder):
        return os.path.join(folder, DATA_FILE_NAME)
    return None

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
    path = get_data_path()
    if not path or not os.path.exists(path):
        return {"songs": []}
    with open(path, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except:
            return {"songs": []}

def save_data(data):
    path = get_data_path()
    if not path:
        # If no project folder, we might want to prompt or fallback
        # But for now, let's assume UI handles this.
        return False
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    return True

@app.get("/api/config")
def get_config():
    return get_settings()

@app.post("/api/config")
def set_config(data: dict):
    settings = get_settings()
    settings.update(data)
    save_settings(settings)
    return {"status": "success"}

@app.get("/api/songs")
def get_songs():
    return load_data()

@app.post("/api/songs")
def save_songs(data: AppData):
    success = save_data(data.model_dump())
    if not success:
        raise HTTPException(status_code=400, detail="Project folder not set")
    return {"status": "success"}

@app.get("/api/pick-folder")
def pick_folder():
    import subprocess
    script = '''
    set theFolder to (choose folder with prompt "プロジェクトフォルダを選択してください")
    return "PATH_RESULT:" & (POSIX path of theFolder)
    '''
    try:
        process = subprocess.Popen(['osascript', '-e', script], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        stdout, stderr = process.communicate()
        for line in stdout.splitlines():
            if "PATH_RESULT:" in line:
                folder_path = line.split("PATH_RESULT:")[1].strip()
                return {"path": folder_path}
        return {"path": ""}
    except Exception as e:
        return {"path": ""}

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
    # Try absolute path first
    if os.path.exists(path):
        return FileResponse(path)
    
    # Try relative to project folder
    settings = get_settings()
    folder = settings.get("project_folder")
    if folder:
        # If the path starts with ./ remove it
        clean_path = path[2:] if path.startswith("./") else path
        full_path = os.path.join(folder, clean_path)
        if os.path.exists(full_path):
            return FileResponse(full_path)
            
    raise HTTPException(status_code=404, detail="File not found")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
