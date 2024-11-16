from flask import Flask
from flask_sock import Sock
app = Flask(__name__, 
    static_folder='static',
    template_folder='templates'
)
sock = Sock(app)
app.config['SOCK_SERVER_OPTIONS'] = {'ping_interval': 25}
from app.routes import main
def create_app():
    return app