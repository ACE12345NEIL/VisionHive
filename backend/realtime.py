class ConnectionManager:
    def __init__(self): self.clients=set()
    async def connect(self,ws): await ws.accept(); self.clients.add(ws)
    def disconnect(self,ws): self.clients.discard(ws)
    async def broadcast(self,message):
        for ws in list(self.clients):
            try: await ws.send_json(message)
            except Exception: self.disconnect(ws)
manager=ConnectionManager()
