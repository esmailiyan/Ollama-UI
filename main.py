from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import json
import asyncio
from typing import List, Optional
import httpx
import os

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Store active connections for cancellation
active_connections: dict[str, WebSocket] = {}
cancellation_flags: dict[str, bool] = {}

# Ollama API URL
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")


@app.get("/", response_class=HTMLResponse)
async def read_root():
    """Serve the main HTML page"""
    with open("static/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/api/models")
async def get_models():
    """Get available models from models.json"""
    try:
        with open("models.json", "r", encoding="utf-8") as f:
            models_data = json.load(f)
        return models_data
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Models file not found")


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    """WebSocket endpoint for chat with streaming support"""
    await websocket.accept()
    connection_id = id(websocket)
    active_connections[str(connection_id)] = websocket
    cancellation_flags[str(connection_id)] = False

    try:
        while True:
            # Receive message from client
            data = await websocket.receive_json()
            
            if data.get("type") == "cancel":
                cancellation_flags[str(connection_id)] = True
                await websocket.send_json({"type": "cancelled"})
                continue

            # Reset cancellation flag
            cancellation_flags[str(connection_id)] = False

            model = data.get("model", "qwen3")
            messages = data.get("messages", [])
            system_prompt = data.get("system_prompt", "")

            # Prepare messages for Ollama
            ollama_messages = []
            if system_prompt:
                ollama_messages.append({
                    "role": "system",
                    "content": system_prompt
                })
            ollama_messages.extend(messages)

            # Send thinking indicator
            await websocket.send_json({
                "type": "thinking",
                "content": "در حال پردازش..."
            })

            try:
                # Stream response from Ollama using HTTP API
                async with httpx.AsyncClient(timeout=300.0) as client:
                    async with client.stream(
                        "POST",
                        f"{OLLAMA_HOST}/api/chat",
                        json={
                            "model": model,
                            "messages": ollama_messages,
                            "stream": True
                        }
                    ) as response:
                        if response.status_code != 200:
                            error_text = await response.aread()
                            await websocket.send_json({
                                "type": "error",
                                "content": f"خطا در ارتباط با Ollama: {response.status_code}"
                            })
                            continue

                        full_response = ""
                        async for line in response.aiter_lines():
                            # Check if cancelled
                            if cancellation_flags.get(str(connection_id), False):
                                await websocket.send_json({
                                    "type": "cancelled",
                                    "content": "پاسخ متوقف شد"
                                })
                                break

                            if not line.strip():
                                continue

                            try:
                                chunk_data = json.loads(line)
                                if "message" in chunk_data and "content" in chunk_data["message"]:
                                    content = chunk_data["message"]["content"]
                                    full_response += content
                                    
                                    # Send chunk to client
                                    await websocket.send_json({
                                        "type": "chunk",
                                        "content": content
                                    })

                                # Check if done
                                if chunk_data.get("done", False):
                                    break
                            except json.JSONDecodeError:
                                continue

                        # Send completion signal
                        if not cancellation_flags.get(str(connection_id), False):
                            await websocket.send_json({
                                "type": "done",
                                "content": full_response
                            })

            except Exception as e:
                await websocket.send_json({
                    "type": "error",
                    "content": f"خطا در ارتباط با مدل: {str(e)}"
                })

    except WebSocketDisconnect:
        pass
    finally:
        # Cleanup
        if str(connection_id) in active_connections:
            del active_connections[str(connection_id)]
        if str(connection_id) in cancellation_flags:
            del cancellation_flags[str(connection_id)]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
