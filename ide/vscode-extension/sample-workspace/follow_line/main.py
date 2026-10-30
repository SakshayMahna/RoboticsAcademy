import HAL
import WebGUI

while True:
    img = HAL.getImage()
    WebGUI.showImage(img)
    HAL.setV(1)
    HAL.setW(0.0)
