from functools import wraps
from flask import request, jsonify
from pydantic import ValidationError

def validate_request_body(model):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            # Check if JSON even exists
            data = request.get_json(silent=True)
            
            if data is None:
                return jsonify({"error": "Request body must be valid JSON"}), 415
            
            try:
                # Validate the body
                validated_model = model.model_validate(data)
                return f(validated_model, *args, **kwargs)
            except ValidationError as e:
                return jsonify({
                    "error": "Validation Failed",
                    "location": "request_body",
                    "details": e.errors(include_url=False)
                }), 400
        return wrapper
    return decorator