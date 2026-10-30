# Editor stubs for the Follow Line HAL. The real HAL.py is injected by the Robotics Academy
# extension when you press Run; you don't need it in your project.
import numpy

def getImage() -> numpy.ndarray:
    """Latest camera frame as a BGR uint8 array (height x width x 3)."""
    ...

def setV(velocity: float) -> None:
    """Linear velocity (m/s)."""
    ...

def setW(velocity: float) -> None:
    """Angular velocity (rad/s)."""
    ...
