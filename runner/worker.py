from pytrickle import StreamProcessor
from pytrickle.frames import VideoFrame
import os
import asyncio
import logging
import time
import random
from torchvision import transforms
from copy import deepcopy
import multiprocessing as mp
from PIL import Image, ImageDraw, ImageFont
from fractions import Fraction

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger()

processor = None
background_tasks = []
background_task_started = False

to_pil = transforms.ToPILImage()
to_tensor = transforms.ToTensor()
fps = 10
pts = 0
pts_inc = 90_000 // 10 #10fps time between frames + 1
time_base = Fraction(1,90_000) #mpegts time_base

async def load_model(**kwargs):
    logger.info("Loading video generator, no model needed for example worker")
    logger.info("Worker is ready")
    # Initialize the Krea frame generator
    global frame_gen
    try:
        # Use the same FPS as the worker's configuration
        frame_gen = frame_generator(
            prompts_list=sample_prompts,
            config_path="krea-realtime-video/configs/self_forcing_server_14b.yaml",
            fps=fps,
        )
        logger.info("Krea frame generator initialized")
    except Exception as e:
        logger.error(f"Failed to initialize Krea frame generator: {e}")

import torch
import sys
import os

# Add the Krea realtime video package to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), "krea-realtime-video"))

# Import prompts from the sample module within the Krea package
from sample import prompts as sample_prompts

# Import the frame generator we just created
from run_krea_gen import frame_generator

# Global frame generator (initialized in load_model)
frame_gen = None

async def send_frame():
    """Send the next generated frame to the stream processor."""
    global pts, pts_inc, time_base, frame_gen
    if frame_gen is None:
        logger.error("Frame generator not initialized")
        return

    try:
        # Get next frame tensor from generator
        frame_tensor = next(frame_gen)
    except StopIteration:
        logger.info("All frames have been sent; stopping video generation")
        return

    # Ensure tensor shape is [C, H, W]
    if frame_tensor.ndim == 4 and frame_tensor.shape[0] == 1:
        frame_tensor = frame_tensor.squeeze(0)

    # Create VideoFrame and send
    frame = VideoFrame.from_av_video(frame_tensor, pts, time_base)
    pts += pts_inc
    await processor.send_frame(frame)
    
async def send_video():
    while True:
        await send_frame()
        await asyncio.sleep(0.031) #sleep a bit then generate frame

async def start_video_gen():
    global background_task_started, background_tasks
    if not background_task_started and processor:
        task = asyncio.create_task(send_video())
        background_tasks.append(task)
        background_task_started = True
        logger.info("Started background video gen task")
    
async def on_stream_stop():
    """Called when stream stops - cleanup background tasks."""
    global background_tasks, background_task_started
    logger.info("Stream stopped, cleaning up background tasks")

    for task in background_tasks:
        if not task.done():
            task.cancel()
            logger.info("Cancelled background task")

    background_tasks.clear()
    background_task_started = False  # Reset flag for next stream
    logger.info("All background tasks cleaned up")
    
async def run_processor():
    #start video gen
    await start_video_gen()
    
    logger.info("Running stream processor")
    await processor.run_forever()
    
if __name__ == "__main__":
    logger.info("Starting video generator worker")

    processor = StreamProcessor(
        model_loader=load_model,   # will block until worker ready
        on_stream_stop=on_stream_stop,
        name="video-gen",
    )

    try:
        #blocks until done
        asyncio.run(run_processor())
    except KeyboardInterrupt:
        pass