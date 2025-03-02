from transformers import AutoTokenizer, AutoModelForCausalLM
import torch
from functools import lru_cache

##############################################
# Code Generation Model
##############################################
CODE_MODEL_ID = "Salesforce/codegen-350M-multi"  # Optimized for code generation
code_tokenizer = AutoTokenizer.from_pretrained(CODE_MODEL_ID)
code_model = AutoModelForCausalLM.from_pretrained(
    CODE_MODEL_ID,
    torch_dtype=torch.float32,
    low_cpu_mem_usage=True
)
code_model.eval()

@lru_cache(maxsize=100)
def generate_code_reply(prompt: str, max_new_tokens: int = 150) -> str:
    inputs = code_tokenizer(prompt, return_tensors="pt")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    inputs = {k: v.to(device) for k, v in inputs.items()}
    with torch.no_grad():
        output_ids = code_model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            repetition_penalty=1.2
        )
    generated = code_tokenizer.decode(output_ids[0], skip_special_tokens=True)
    return generated[len(prompt):].strip()

##############################################
# Conversational Chat Model
##############################################
CHAT_MODEL_ID = "microsoft/DialoGPT-medium"  # Conversational model for human-like responses
chat_tokenizer = AutoTokenizer.from_pretrained(CHAT_MODEL_ID)
chat_model = AutoModelForCausalLM.from_pretrained(
    CHAT_MODEL_ID,
    torch_dtype=torch.float32,
    low_cpu_mem_usage=True
)
chat_model.eval()

@lru_cache(maxsize=100)
def generate_chat_reply(prompt: str, max_new_tokens: int = 50) -> str:
    inputs = chat_tokenizer(prompt, return_tensors="pt")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    inputs = {k: v.to(device) for k, v in inputs.items()}
    with torch.no_grad():
        output_ids = chat_model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=True,
            temperature=0.8,           # Slightly higher for more creativity
            top_p=0.92,                # Higher top_p for more varied vocabulary
            repetition_penalty=1.15,   # Slightly lower to allow natural repetition
            pad_token_id=chat_tokenizer.eos_token_id,
            eos_token_id=chat_tokenizer.eos_token_id,
            no_repeat_ngram_size=2,    # Lower for more natural speech patterns
            length_penalty=0.8,        # Favors slightly longer responses
            num_beams=3,               # Good balance of quality vs speed
            early_stopping=True        # Stop when valid ending found
        )
    generated = chat_tokenizer.decode(output_ids[0], skip_special_tokens=True)
    return generated[len(prompt):].strip()

##############################################
# Mixture Mode: Combine Code + Chat
##############################################
def generate_mixture_reply(prompt: str, max_new_tokens: int = 150) -> str:
    # First, generate a code-focused reply.
    code_part = generate_code_reply(prompt, max_new_tokens=max_new_tokens // 2)
    # Then, ask the chat model to add a conversational "flavor" or commentary.
    mixed_prompt = f"Here is a piece of code:\n{code_part}\nNow, rewrite it with a conversational explanation."
    chat_part = generate_chat_reply(mixed_prompt, max_new_tokens=max_new_tokens // 2)
    # Combine the two outputs.
    return f"{code_part}\n\n{chat_part}"

##############################################
# Dynamic max token adjustment
##############################################
def adjust_max_tokens(prompt: str, default_max: int = 1000) -> int:
    word_count = len(prompt.split())
    # Reduce max tokens if prompt is very long.
    reduction = max(0, (word_count - 100) * 5)
    return max(50, default_max - reduction)
