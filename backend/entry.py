"""Worker entrypoint shim, at the project root on purpose.

wrangler treats the main module's directory as the module root. With the shim here the
root is ``backend/`` and ``time_track/`` stays a real package, so its relative imports
resolve (pointing ``main`` at ``time_track/entry.py`` fails at boot with "attempted
relative import with no known parent package").
"""

from time_track.entry import Default  # noqa: F401  (re-exported for the runtime)
