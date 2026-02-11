from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS

load_dotenv()

from routes import api

app = Flask(__name__)
CORS(app)
app.register_blueprint(api)