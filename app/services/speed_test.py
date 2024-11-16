import json

class SpTest:
    def __init__(self):
        self.ws_cons = set()

    def send_msg(self, msg_type, data):
        msg = {"type": msg_type, "prog": data.get("pg", 0), "sp": data.get("sp", 0)}
        dead = set()
        for ws in self.ws_cons:
            try:
                ws.send(json.dumps(msg))
            except Exception as e:
                print(f"发送消息失败: {e}")
                dead.add(ws)
        self.ws_cons -= dead
