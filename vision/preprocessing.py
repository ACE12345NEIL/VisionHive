import cv2

def resize(frame, width):
    h,w=frame.shape[:2]
    return frame if w<=width else cv2.resize(frame,(width,round(h*width/w)),interpolation=cv2.INTER_AREA)

def preprocess(frame, mode='contrast'):
    """BGR input. Modes demonstrate gray/RGB conversion, blur and histogram enhancement."""
    if mode=='gray': return cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
    if mode=='gaussian': return cv2.GaussianBlur(frame,(5,5),0)
    if mode=='median': return cv2.medianBlur(frame,5)
    if mode=='contrast':
        lab=cv2.cvtColor(frame,cv2.COLOR_BGR2LAB); l,a,b=cv2.split(lab)
        l=cv2.createCLAHE(clipLimit=2,tileGridSize=(8,8)).apply(l)
        return cv2.cvtColor(cv2.merge((l,a,b)),cv2.COLOR_LAB2BGR)
    return frame
