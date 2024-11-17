from flask import Flask
import gc
import psutil
import os
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime

app = Flask(__name__, static_folder="static", template_folder="templates")

def cleanup_memory():

    try:

        process = psutil.Process(os.getpid())
        mem_before = process.memory_info().rss / 1024 / 1024

        gc.collect()

        if hasattr(process, "memory_maps"):
            process.memory_maps()

        mem_after = process.memory_info().rss / 1024 / 1024
        print(
            f"[{datetime.now()}] Process memory cleanup: {mem_before:.1f}MB -> {mem_after:.1f}MB"
        )

    except Exception as e:
        print(f"Process memory cleanup failed: {e}")


def create_app():

    scheduler = BackgroundScheduler()

    scheduler.add_job(cleanup_memory, "interval", hours=6)

    scheduler.start()

    return app


from app.routes import main
