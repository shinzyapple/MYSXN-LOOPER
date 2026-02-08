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

# Vercel-friendly structure
# On Vercel, everything is bundled. Let's keep the API minimal
# as we will move most logic (saving/loading) to localStorage for Web version.

class Section(BaseModel):
    id: str
    name: str
    file: str
    type: str # 'intro', 'loop', 'outro'
    crossfade: bool = True

class Song(BaseModel):
    id: str
    name: str
    sections: List[Section]

class AppData(BaseModel):
    songs: List[Song]

@app.get("/api/songs")
def get_songs():
    # On Vercel, we might provide some default demo songs if needed,
    # but the primary data will live in the user's browser.
    return {"songs": []}

@app.get("/api/config")
def get_config():
    # Vercel version doesn't have a "project folder" on the server
    return {"is_vercel": True}

@app.get("/api/pick-folder")
def pick_folder():
    raise HTTPException(status_code=400, detail="Folder picking is only supported in the Local App version.")

@app.get("/api/pick-file")
def pick_file():
    raise HTTPException(status_code=400, detail="Native file picking is only supported in the Local App version.")

# For serving static files in development (when running api/index.py directly)
# StaticFiles is usually handled by Vercel's config, but good to have a fallback.
# Note: Vercel usually handles "/" to static/index.html via vercel.json.
