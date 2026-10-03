SENSITIVITY_WEIGHTS = {
"social security": 1.0,
"ssn": 1.0,
"account number": 0.9,
"routing number": 0.9,
"password": 1.0,
"credit card": 1.0,
"financial": 0.7,
"client": 0.6,
"employee": 0.5,
"confidential": 0.8, 
}

def score_sensitvety(text: str) -> float:
    text = text.lower()
    score = 0.0

    for keyword, weight in SENSITIVITY_WEIGHTS.items():
        if keyword in text:
            score = max(score, weight)
            return score
