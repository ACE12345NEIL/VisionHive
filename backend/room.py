from .config import settings
from .schemas import Point, Room, Zone

def virtual_room() -> Room:
    w,h=settings.room['width_m'],settings.room['height_m']; mx,my=w/2,h/2
    quadrants=[[(0,0),(mx,0),(mx,my),(0,my)],[(mx,0),(w,0),(w,my),(mx,my)],[(0,my),(mx,my),(mx,h),(0,h)],[(mx,my),(w,my),(w,h),(mx,h)]]
    names=['North West','North East','South West','South East']
    zones=[Zone(id=f'zone-{i+1}',name=names[i],polygon=[Point(x=x,y=y) for x,y in q]) for i,q in enumerate(quadrants)]
    return Room(id=settings.room['id'],name=settings.room['name'],width_m=w,height_m=h,zones=zones)
