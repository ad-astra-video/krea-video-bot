import torch
from fractions import Fraction
import sys
import os

# Ensure the Krea realtime video package directory is on the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), "krea-realtime-video"))

# Import necessary components from the Krea realtime video package
from release_server import (
    load_merge_config,
    load_all,
    GenerateParams,
    GenerationSession,
    Models,
)
from sample import prompts as default_prompts

def frame_generator(
    prompts_list=None,
    config_path="krea-realtime-video/configs/self_forcing_server_14b.yaml",
    fps=10,
):
    """
    Yields video frames (torch tensors of shape [3, H, W]) for each prompt
    in ``prompts_list`` using the Krea realtime video generation pipeline.

    Parameters
    ----------
    prompts_list : list[str] | None
        List of text prompts. If ``None``, the default prompts from
        ``krea-realtime-video.sample`` are used.
    config_path : str
        Path to the model configuration YAML file.
    fps : int
        Frames‑per‑second for the generated video (used only for timing;
        the generator itself is agnostic to FPS).

    Yields
    ------
    torch.Tensor
        A single video frame tensor with shape ``[3, H, W]``.
    """
    if prompts_list is None:
        prompts_list = default_prompts

    # Load configuration and models once
    config = load_merge_config(config_path)
    models = load_all(config)

    # Prepare generation parameters (use defaults, then set the prompt)
    params = GenerateParams()

    for prompt_idx, prompt in enumerate(prompts_list):
        # Set the current prompt
        params.prompt = prompt

        # Collect frames as they are generated
        collected_frames = []

        def frame_callback(pixels, frame_ids, event):
            """
            Callback invoked after each block is generated.
            ``pixels`` is a tensor on the GPU with shape
            ``[1, num_frames, 3, H, W]``.
            """
            # Ensure GPU work is finished before moving to CPU
            event.synchronize()
            # Convert to CPU and normalize to [0, 1]
            cpu_pixels = pixels.cpu().add_(1.0).mul_(0.5).clamp_(0.0, 1.0)
            collected_frames.append(cpu_pixels)

        # Create a generation session for the current prompt
        session = GenerationSession(
            params=params,
            config=config,
            frame_callback=frame_callback,
            models=models,
        )

        # Generate all blocks for this prompt
        num_blocks = params.num_blocks
        for _ in range(num_blocks):
            session.generate_block(models)

        # Concatenate all frames across blocks: shape [1, total_frames, 3, H, W]
        combined = torch.cat(collected_frames, dim=1)

        # Yield each frame individually
        total_frames = combined.shape[1]
        for i in range(total_frames):
            # combined[0, i] -> shape [3, H, W]
            yield combined[0, i]

        # Clean up the session before moving to the next prompt
        session.dispose()