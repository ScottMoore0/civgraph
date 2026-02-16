# Repairing the referendum simulator environment

The repository ships with `repair_environment.py`, a helper script that
reinstalls dependencies, clears Python bytecode caches, and checks that the
referendum model can be deserialised correctly under NumPy 2.x. The script
prints progress to the console and also writes a detailed log to
`repair_environment.log` in the project root.

## Running from PyCharm

1. Open the project in PyCharm and make sure the interpreter for the project is
   pointed at the virtual environment that should run the simulator. You can do
   this via **File ▸ Settings ▸ Project ▸ Python Interpreter**.
2. Open the built-in terminal (**View ▸ Tool Windows ▸ Terminal**). PyCharm
   automatically activates the selected interpreter in this terminal.
3. Run the repair workflow:

   ```bash
   python -m repair_environment
   ```

   Use `--skip-install` if `pip install -r requirements-dev.txt` has already
   been executed in the selected interpreter, or `--skip-clear-cache` if you do
   not want the script to delete `__pycache__` directories.
4. Check the terminal output. If every step succeeds you will see
   `All steps completed successfully.`. Otherwise open `repair_environment.log`
   in the project root to inspect the full stack trace and command output.

## Running from GitHub Desktop

GitHub Desktop provides a “Open in Terminal” shortcut that launches a shell in
the repository root. Use that option (or open the folder in a terminal
manually), activate the interpreter you use for the simulator, and run the same
`python -m repair_environment` command as above. The script does not depend on
PowerShell specifically, so it works from CMD, PowerShell, Windows Terminal, or
any Unix-like shell you prefer.

## Typical options

* `--skip-install` – useful if `pip` reports that everything is already
  satisfied and you only need to re-run the verification step.
* `--skip-clear-cache` – leaves existing `__pycache__` directories untouched.
* `--include-venv-caches` – when cache clearing is enabled, also purge caches
  inside nested virtual environments.
* `--skip-verify` – prevents the script from loading the referendum model. This
  is mainly helpful when you only need to install dependencies or clear caches.

If verification fails, the error message always includes the exception class
and message (for example `ValueError: state is not a legacy MT19937 state`).
Check the log file for the full traceback, reinstall dependencies in the
active interpreter if necessary, and then re-run the script.

