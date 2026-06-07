"""CLI entry point for content-understand-engine."""

from __future__ import annotations

import argparse
import json
import logging
import sys

from content_understand.config import BackendConfig, ContentConfig
from content_understand.pipeline import ContentPipeline


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="content-understand",
        description="Understand content from a URL or local file.",
    )
    parser.add_argument("inputs", nargs="+", help="URLs or local file paths")
    parser.add_argument(
        "--backend",
        default="mimo",
        help="Model backend to use (default: mimo)",
    )
    parser.add_argument("--api-base", default="", help="API base URL")
    parser.add_argument("--api-key", default="", help="API key (comma-separated for rotation)")
    parser.add_argument("--model", default="", help="Model name override")
    parser.add_argument(
        "--output",
        choices=["json", "text"],
        default="text",
        help="Output format",
    )
    parser.add_argument("--verbose", action="store_true", help="Verbose logging")
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.DEBUG)
    else:
        logging.basicConfig(level=logging.INFO)

    keys = [k.strip() for k in args.api_key.split(",") if k.strip()]
    model = args.model or None

    config = ContentConfig(
        backends={
            args.backend: BackendConfig(
                type=args.backend,
                api_base=args.api_base,
                api_keys=keys,
                model=model or "",
            ),
        },
        video_backend=args.backend,
        image_backend=args.backend,
        audio_backend=args.backend,
        article_backend=args.backend,
    )

    pipeline = ContentPipeline(config)

    for input_url in args.inputs:
        try:
            result = pipeline.understand(input_url)
            if args.output == "json":
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                print(f"# {result.get('title', 'Untitled')}")
                print()
                print(result.get("summary", ""))
                if result.get("tags"):
                    print()
                    print("Tags:", " ".join(f"#{t}" for t in result["tags"]))
                print()
        except FileNotFoundError as e:
            msg = str(e)
            if "ffmpeg" in msg.lower():
                print(
                    "Error: ffmpeg is not installed. Install it:\n"
                    "  brew install ffmpeg  (macOS)\n"
                    "  apt install ffmpeg  (Ubuntu/Debian)",
                    file=sys.stderr,
                )
            else:
                print(f"Error: File not found: {e}", file=sys.stderr)
            sys.exit(1)
        except RuntimeError as e:
            msg = str(e)
            if "yt-dlp" in msg.lower():
                print(f"Error: {msg}\nInstall: pip install yt-dlp", file=sys.stderr)
            elif "ffmpeg" in msg.lower():
                print(f"Error: {msg}\nInstall: brew install ffmpeg", file=sys.stderr)
            else:
                print(f"Error: {msg}", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(f"Unexpected error: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
