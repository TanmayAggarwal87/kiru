import sys

import typer
from rich.console import Console
from rich.table import Table

from kiru_worker.config import get_settings
from kiru_worker.doctor import run_doctor_checks

app = typer.Typer(
    name="kiru-worker",
    help="Kiru AI Worker CLI for video processing",
    add_completion=False,
)
console = Console()


@app.command()
def doctor() -> None:
    """Check system environment, tools (ffmpeg, ffprobe, libass), and paths."""
    console.print("\n[bold cyan]Checking Kiru Worker environment...[/bold cyan]\n")
    settings = get_settings()
    results = run_doctor_checks(settings)

    table = Table(title="Doctor Report", show_header=True, header_style="bold magenta")
    table.add_column("Component", style="dim", width=20)
    table.add_column("Status", width=10)
    table.add_column("Details")

    all_passed = True
    for res in results:
        status = "[bold green]PASS[/bold green]" if res.passed else "[bold red]FAIL[/bold red]"
        if not res.passed:
            all_passed = False
        table.add_row(res.name, status, res.message)

    console.print(table)
    if all_passed:
        console.print("\n[bold green]✓ All prerequisite checks passed.[/bold green]\n")
    else:
        console.print(
            "\n[bold red]✗ Some checks failed. Resolve them before proceeding.[/bold red]\n"
        )
        sys.exit(1)


@app.command()
def run() -> None:
    """Run worker daemon (P2)."""
    console.print("[yellow]Runner daemon will be implemented in Phase 2.[/yellow]")


@app.command(name="run-once")
def run_once() -> None:
    """Claim and execute one job then exit (P2)."""
    console.print("[yellow]Run-once will be implemented in Phase 2.[/yellow]")


@app.command()
def selftest() -> None:
    """Run stages locally on synthetic media without API (P2)."""
    console.print("[yellow]Selftest will be implemented in Phase 2.[/yellow]")


@app.command(name="eval")
def eval_cmd() -> None:
    """Run offline evaluation harness (P5)."""
    console.print("[yellow]Evaluation harness will be implemented in Phase 5.[/yellow]")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
