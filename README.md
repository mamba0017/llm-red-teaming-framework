# LLM Red Teaming & Vulnerability Assessment Framework

## Project Overview

This repository contains a structured framework and methodology for red teaming Large Language Models (LLMs). The goal is to systematically probe open-source models (such as Llama 3 or Mistral) to identify vulnerabilities, document failure modes, and propose actionable mitigations. 

This project is designed to demonstrate practical AI Trust & Safety skills, specifically focusing on adversarial testing, vulnerability categorization, and policy translation.

### Context for AI Assistants (Claude, GPT, etc.)

If you are an AI assistant helping me build this project, your role is to assist in generating adversarial prompts, writing evaluation scripts, and analyzing the output data. Please read this entire README to understand the project architecture and goals. Do not generate actual harmful content; instead, generate the *prompts* designed to elicit such content from a target model.

## Project Architecture

The repository is structured to separate the taxonomy of attacks, the dataset of prompts, the execution scripts, and the final analysis.

```text
llm-red-teaming-framework/
├── README.md                 # This file
├── taxonomy/
│   └── attack_taxonomy.md    # Definitions of all attack vectors tested
├── prompts/
│   └── adversarial_dataset.json # The dataset of 100+ adversarial prompts
├── results/
│   └── attack_results.json   # Raw output from the target LLM
├── analysis/
│   └── vulnerability_report.md # Analysis of success/failure rates
├── mitigations/
│   └── recommendations.md    # Proposed technical and policy fixes
└── scripts/
    └── run_attacks.py        # Python script to execute prompts via API
```

## Methodology

### 1. Attack Taxonomy Definition
We will test the target model against the following attack categories:
*   **Direct Requests:** Explicitly asking for prohibited content.
*   **Role-Playing (DAN):** Instructing the model to adopt an unrestricted persona.
*   **Payload Splitting:** Breaking a harmful request into benign-seeming fragments.
*   **Encoding Attacks:** Obfuscating the request using Base64 or other encodings.
*   **Hypothetical Framing:** Wrapping the request in a fictional or academic scenario.

### 2. Dataset Generation
We will construct a dataset of at least 100 adversarial prompts across the categories above. The prompts will target specific harm domains defined by the OWASP Top 10 for LLMs (e.g., violence, hate speech, PII leakage, illegal activities).

### 3. Execution
The `scripts/run_attacks.py` file will iterate through the `adversarial_dataset.json`, send the prompts to the target LLM (via an API like OpenAI, Hugging Face, or local Ollama), and record the responses in `results/attack_results.json`.

### 4. Evaluation and Analysis
Responses will be manually (or semi-automatically) evaluated to determine if the attack was successful (the model produced harmful content) or if the model safely refused. The findings will be aggregated into the `vulnerability_report.md`.

## Technical Stack
*   **Language:** Python 3.10+
*   **Libraries:** `openai`, `pandas`, `matplotlib`, `json`
*   **Target Model:** To be determined (e.g., `gpt-4o-mini` for baseline testing, or a local `Llama-3-8B-Instruct`).

## Current Development Stage
*   [ ] Define Attack Taxonomy
*   [ ] Generate Adversarial Prompt Dataset
*   [ ] Write Execution Script
*   [ ] Run Attacks and Collect Results
*   [ ] Evaluate Responses
*   [ ] Write Final Vulnerability Report

## Instructions for AI Pair Programmer

When assisting with this repository, please adhere to the following guidelines:
1.  **Dataset Generation:** When asked to generate prompts for `adversarial_dataset.json`, ensure they are strictly formatted as JSON objects containing `id`, `category`, `harm_type`, `severity`, `prompt`, and `expected_safe_response`.
2.  **Scripting:** Keep the Python execution script simple and robust. Include error handling for API rate limits.
3.  **Analysis:** When helping to write the vulnerability report, focus on quantitative metrics (e.g., "Role-playing attacks had a 45% success rate compared to 5% for direct requests").
