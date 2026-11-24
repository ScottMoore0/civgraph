#!/usr/bin/env python3
"""Where the historic-census scripts (hist_census_*.py) read and write.

  OUT   the working folder for extracted tables, crosswalks and series: --out on every script,
        else the HIST_CENSUS_OUT environment variable, else tmp/hist-census in the checkout
        (gitignored). Outputs never go into the repository.
  MAIN  the checkout holding data/maps and data/census (the maps are gitignored, so a worktree
        reads its main checkout's copies; found from the worktree's .git file).
  REPORTS   the folder of the census report PDFs (hist-census-pages.json names the files):
            HIST_CENSUS_REPORTS, or --reports where a script takes it.
  SRC_1926  the folder of NISRA's 1926 data-table workbooks: HIST_CENSUS_1926_SRC, or --src.
"""
import os
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[3]


def main_checkout(repo=REPO):
    """The main checkout of a git worktree (its .git is a file 'gitdir: <main>/.git/worktrees/<name>'),
    or the checkout itself."""
    git = Path(repo) / '.git'
    if git.is_file():
        line = git.read_text(encoding='utf-8').strip()
        if line.startswith('gitdir:'):
            gitdir = Path(line[len('gitdir:'):].strip())
            if gitdir.parent.name == 'worktrees':
                return gitdir.parents[2]
    return Path(repo)


MAIN = main_checkout()
MAPS = MAIN / 'data' / 'maps'
DERIVED = MAIN / 'data' / 'census' / 'derived'
OUT = os.environ.get('HIST_CENSUS_OUT') or str(REPO / 'tmp' / 'hist-census')
REPORTS = os.environ.get('HIST_CENSUS_REPORTS', '')
SRC_1926 = os.environ.get('HIST_CENSUS_1926_SRC', '')
