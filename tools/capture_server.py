"""Static server + frame sink for the video showcase (everything stays on D:).

POST /frame?i=N   body=JPEG  -> out/frames/NNNNN.jpg
POST /audio       body=WAV   -> out/audio.wav
POST /video       body=MP4   -> out/video.mp4 (WebCodecs fast path)
POST /done        body=JSON  -> out/done.json, then ffmpeg muxes out/privada_showcase.mp4
"""
import glob, http.server, json, os, re, subprocess, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out")
os.makedirs(os.path.join(OUT, "frames"), exist_ok=True)


def ffmpeg():
    hits = glob.glob("D:/tools/ffmpeg/*/bin/ffmpeg.exe")
    return hits[0] if hits else "ffmpeg"


def make_video(info):
    final = os.path.join(OUT, "privada_showcase.mp4")
    audio = os.path.join(OUT, "audio.wav")
    if info.get("mode") == "webcodecs":
        cmd = [ffmpeg(), "-y", "-i", os.path.join(OUT, "video.mp4"), "-i", audio,
               "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final]
    else:
        cmd = [ffmpeg(), "-y", "-framerate", str(info.get("fps", 30)), "-i", os.path.join(OUT, "frames", "%05d.jpg"),
               "-i", audio, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", final]
    r = subprocess.run(cmd, capture_output=True, text=True)
    print("ffmpeg exit", r.returncode, r.stderr[-400:] if r.returncode else "", flush=True)
    print("VIDEO:", final, flush=True)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=os.path.join(ROOT, "web"), **k)

    def log_message(self, fmt, *args):
        msg = fmt % args
        if "POST" in msg and "/frame" not in msg:
            sys.stderr.write(msg + chr(10))

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        n = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(n)
        if u.path == "/frame":
            i = int(urllib.parse.parse_qs(u.query)["i"][0])
            path = os.path.join(OUT, "frames", "%05d.jpg" % i)
            if i % 60 == 0:
                print("frame", i, flush=True)
        elif u.path == "/thumb":
            # static thumbnail generator (web/tools/gen-thumbs.html) -> web/thumbs/<path>
            rel = urllib.parse.parse_qs(u.query)["path"][0].replace("\\", "/")
            if ".." in rel or rel.startswith("/") or not re.fullmatch(r"[a-z0-9_\-/.]+", rel):
                self.send_error(400)
                return
            path = os.path.join(ROOT, "web", "thumbs", *rel.split("/"))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            print("thumb", rel, len(data), flush=True)
        elif u.path == "/video":
            path = os.path.join(OUT, "video.mp4")
        elif u.path == "/audio":
            path = os.path.join(OUT, "audio.wav")
        elif u.path == "/done":
            path = os.path.join(OUT, "done.json")
            print("DONE", data.decode()[:200], flush=True)
        else:
            self.send_error(404)
            return
        with open(path, "wb") as f:
            f.write(data)
        if u.path == "/done":
            info = json.loads(data or b"{}")
            have = len(os.listdir(os.path.join(OUT, "frames")))
            total = info.get("frames", 0)
            print("chunk done", info.get("from"), info.get("to"), "frames on disk", have, "/", total, flush=True)
            if info.get("mode") == "webcodecs" or (have >= total and os.path.exists(os.path.join(OUT, "audio.wav"))):
                make_video(info)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print("capture server on http://127.0.0.1:%d/showcase.html" % port, flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
