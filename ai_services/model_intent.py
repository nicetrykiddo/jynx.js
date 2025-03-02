from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
from functools import lru_cache

MODEL_NAME = "distilbert-base-uncased-finetuned-sst-2-english"

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
model.eval()

@lru_cache(maxsize=500)
def classify_intent(text: str) -> bool:
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=128)
    with torch.no_grad():
        outputs = model(**inputs)
    logits = outputs.logits if hasattr(outputs, "logits") else outputs[0]
    predicted = torch.argmax(logits[0]).item()
    # Placeholder: return True if positive sentiment (i.e., likely directed at bot)
    return predicted == 1
