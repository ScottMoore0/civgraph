"""How intake runs a plugin's Python step: `python -I run_isolated.py <script> <args...>`.

Ingest scripts read downloaded files, so they run isolated (-I): no PYTHON* environment
variable, and neither the current folder nor a folder named on PYTHONPATH can put a module in
front of the standard library. This launcher then puts back only what the script needs to run as
`python <script> <args...>` did:
  - the user's site-packages (where this machine installs pymupdf, pandas...), in the place
    Python puts it, ahead of the system site-packages;
  - the script's own folder first on sys.path (its sibling modules; repository code, never a
    download folder);
  - PYTHONDONTWRITEBYTECODE, which -I would otherwise ignore;
  - the frozen clock and the offline guard (sitecustomize.py beside this file), when parity or
    --offline set INTAKE_FROZEN_CLOCK or INTAKE_OFFLINE (-I ignores the PYTHONPATH they used).
The script then runs as __main__, with sys.argv as it was."""
import os
import runpy
import site
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))


def _user_site_first():
    user = site.getusersitepackages()
    if not isinstance(user, str) or not os.path.isdir(user):
        return
    before = list(sys.path)
    site.addsitedir(user)
    added = [p for p in sys.path if p not in before]
    idx = next((i for i, p in enumerate(before) if p.rstrip('\\/').lower().endswith('site-packages')), len(before))
    sys.path[:] = before[:idx] + added + before[idx:]


def main():
    if len(sys.argv) < 2:
        sys.exit('usage: python -I run_isolated.py <script> [args...]')
    if os.environ.get('PYTHONDONTWRITEBYTECODE'):
        sys.dont_write_bytecode = True
    _user_site_first()
    if 'INTAKE_FROZEN_CLOCK' in os.environ or os.environ.get('INTAKE_OFFLINE') == '1':
        runpy.run_path(os.path.join(_HERE, 'sitecustomize.py'), run_name='intake_sitecustomize')
    script = os.path.abspath(sys.argv[1])
    sys.argv = sys.argv[1:]
    sys.path.insert(0, os.path.dirname(script))
    runpy.run_path(script, run_name='__main__')


if __name__ == '__main__':
    main()
