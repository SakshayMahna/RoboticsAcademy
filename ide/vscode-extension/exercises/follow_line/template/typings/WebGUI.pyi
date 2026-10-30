# Editor stubs for the Follow Line web GUI (injected on Run).
from typing import Any
import numpy

def showImage(image: numpy.ndarray) -> None:
    """Show an image (e.g. a processed camera frame) in the Web GUI panel."""
    ...

def get_image_mode() -> dict[str, Any]: ...
