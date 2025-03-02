from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from model_intent import classify_intent
from model_llm import generate_code_reply, generate_chat_reply, generate_mixture_reply, adjust_max_tokens
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

class MessageRequest(BaseModel):
    chat_id: str
    text: str
    max_tokens: int = 1000
    mode: str = None

def decide_mode(text: str) -> str:
    """Heuristic to decide mode based on text keywords."""
    code_keywords = ["function", "code", "script", "python", "javascript", "java", "c++", "nodejs", "react", "html", "css", "sql", "database", "api"],
    text_lower = text.lower()
    if any(keyword in text_lower for keyword in code_keywords):
        return "code"
    return "chat"

@app.post("/classify")
async def classify_message(request: MessageRequest):
    try:
        should_reply = classify_intent(request.text)
        logger.info(f"Classification for chat_id {request.chat_id}: {should_reply}")
        return {"should_reply": should_reply}
    except Exception as e:
        logger.error(f"Classification error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate")
async def generate_message(request: MessageRequest, background_tasks: BackgroundTasks):
    try:
        mode = request.mode if request.mode else decide_mode(request.text)
        dynamic_max = adjust_max_tokens(request.text, default_max=request.max_tokens)
        cache_key = f"{request.chat_id}:{request.text}:{dynamic_max}:{mode}"
        if cache_key in response_cache:
            logger.info(f"Cache hit for chat_id {request.chat_id} in mode {mode}")
            return {"reply": response_cache[cache_key]}
        
        if mode.lower() == "code":
            reply = generate_code_reply(request.text, max_new_tokens=dynamic_max)
        elif mode.lower() == "mixture":
            reply = generate_mixture_reply(request.text, max_new_tokens=dynamic_max)
        else:
            reply = generate_chat_reply(request.text, max_new_tokens=dynamic_max)
        
        response_cache[cache_key] = reply
        
        if len(response_cache) > 1000:
            keys_to_remove = list(response_cache.keys())[:200]
            for key in keys_to_remove:
                del response_cache[key]
        
        logger.info(f"Generated reply for chat_id {request.chat_id} in mode {mode}")
        return {"reply": reply}
    except Exception as e:
        logger.error(f"Generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

response_cache = {}
