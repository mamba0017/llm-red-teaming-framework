"""
LLM Client Wrapper for Child Safety Red Teaming Framework
==========================================================
This module provides a unified interface for sending prompts to different LLM backends.
Supported backends:
    - Ollama (local, free)
    - Hugging Face Inference API (free tier)
    - OpenAI-compatible APIs

Usage:
    from llm_client import LLMClient
    
    client = LLMClient(backend="ollama", model="llama3")
    response = client.generate("Your prompt here")
"""

import requests
import json
import time
from typing import Optional, Dict, Any


class LLMClient:
    """Unified LLM client supporting multiple backends."""

    def __init__(
        self,
        backend: str = "ollama",
        model: str = "llama3",
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        timeout: int = 120,
    ):
        """
        Initialize the LLM client.

        Args:
            backend: One of "ollama", "huggingface", or "openai_compatible"
            model: Model name/identifier
            base_url: Override the default API endpoint
            api_key: API key (required for huggingface and openai_compatible)
            temperature: Sampling temperature (0.0 - 1.0)
            max_tokens: Maximum tokens in the response
            timeout: Request timeout in seconds
        """
        self.backend = backend.lower()
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout

        # Set default base URLs
        if base_url:
            self.base_url = base_url
        elif self.backend == "ollama":
            self.base_url = "http://localhost:11434"
        elif self.backend == "huggingface":
            self.base_url = "https://api-inference.huggingface.co/models"
        elif self.backend == "openai_compatible":
            self.base_url = "http://localhost:1234/v1"  # Default for LM Studio
        else:
            raise ValueError(f"Unsupported backend: {backend}")

        self.api_key = api_key

    def generate(self, prompt: str, system_prompt: Optional[str] = None) -> Dict[str, Any]:
        """
        Send a prompt to the LLM and return the response.

        Args:
            prompt: The user prompt to send
            system_prompt: Optional system prompt for context

        Returns:
            Dict containing:
                - response: The model's text response
                - model: Model name used
                - backend: Backend used
                - latency_ms: Response time in milliseconds
                - error: Error message if request failed (None if successful)
        """
        start_time = time.time()

        try:
            if self.backend == "ollama":
                result = self._generate_ollama(prompt, system_prompt)
            elif self.backend == "huggingface":
                result = self._generate_huggingface(prompt, system_prompt)
            elif self.backend == "openai_compatible":
                result = self._generate_openai_compatible(prompt, system_prompt)
            else:
                raise ValueError(f"Unsupported backend: {self.backend}")

            latency_ms = int((time.time() - start_time) * 1000)

            return {
                "response": result,
                "model": self.model,
                "backend": self.backend,
                "latency_ms": latency_ms,
                "error": None,
            }

        except Exception as e:
            latency_ms = int((time.time() - start_time) * 1000)
            return {
                "response": None,
                "model": self.model,
                "backend": self.backend,
                "latency_ms": latency_ms,
                "error": str(e),
            }

    def _generate_ollama(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Generate response using Ollama API."""
        url = f"{self.base_url}/api/chat"

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": self.temperature,
                "num_predict": self.max_tokens,
            },
        }

        response = requests.post(url, json=payload, timeout=self.timeout)
        response.raise_for_status()

        data = response.json()
        return data["message"]["content"]

    def _generate_huggingface(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Generate response using Hugging Face Inference API."""
        url = f"{self.base_url}/{self.model}"

        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        # Format prompt with system context
        full_prompt = prompt
        if system_prompt:
            full_prompt = f"[INST] <<SYS>>\n{system_prompt}\n<</SYS>>\n\n{prompt} [/INST]"

        payload = {
            "inputs": full_prompt,
            "parameters": {
                "temperature": self.temperature,
                "max_new_tokens": self.max_tokens,
                "return_full_text": False,
            },
        }

        response = requests.post(url, headers=headers, json=payload, timeout=self.timeout)
        response.raise_for_status()

        data = response.json()
        if isinstance(data, list) and len(data) > 0:
            return data[0].get("generated_text", "")
        return str(data)

    def _generate_openai_compatible(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Generate response using OpenAI-compatible API (LM Studio, vLLM, etc.)."""
        url = f"{self.base_url}/chat/completions"

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }

        response = requests.post(url, headers=headers, json=payload, timeout=self.timeout)
        response.raise_for_status()

        data = response.json()
        return data["choices"][0]["message"]["content"]

    def health_check(self) -> bool:
        """Check if the backend is reachable and the model is available."""
        try:
            if self.backend == "ollama":
                response = requests.get(f"{self.base_url}/api/tags", timeout=5)
                response.raise_for_status()
                models = [m["name"] for m in response.json().get("models", [])]
                return self.model in models or any(self.model in m for m in models)
            elif self.backend == "openai_compatible":
                response = requests.get(f"{self.base_url}/models", timeout=5)
                return response.status_code == 200
            else:
                return True  # Can't easily health-check HuggingFace
        except Exception:
            return False


if __name__ == "__main__":
    # Quick test
    print("Testing LLM Client...")
    client = LLMClient(backend="ollama", model="llama3")

    if client.health_check():
        print(f"✓ Connected to {client.backend} with model {client.model}")
        result = client.generate("Say hello in one sentence.")
        if result["error"]:
            print(f"✗ Error: {result['error']}")
        else:
            print(f"✓ Response: {result['response']}")
            print(f"  Latency: {result['latency_ms']}ms")
    else:
        print(f"✗ Cannot connect to {client.backend} or model {client.model} not found.")
        print("  Make sure Ollama is running: ollama serve")
        print(f"  Make sure model is pulled: ollama pull {client.model}")
