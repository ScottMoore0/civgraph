#!/usr/bin/env python
"""Scrape British Newspaper Archive for NI election SPNs and related notices.

Uses Playwright to automate a logged-in BNA session.
Searches for nomination notice phrases in Irish newspapers around known election dates.
Downloads article text and page images.

Usage:
    python scrape_bna.py                  # Run all configured elections
    python scrape_bna.py 1962             # Run all configured elections in a year
    python scrape_bna.py "Westminster 1979"  # Run one named election
"""

import json
import os
import re
import sys
import time
from pathlib import Path

# Election dates for missing elections (date = polling day, search window = 2 weeks before)
ELECTIONS = [
    # (name, year, polling_date, search_start, search_end, keywords)
    ("Stormont 1938", 1938, "1938-02-09", "1938-01-26", "1938-02-13", "candidates nominated"),
    ("Stormont 1962", 1962, "1962-05-31", "1962-05-15", "1962-06-07", "persons nominated"),
    ("Stormont 1969", 1969, "1969-02-24", "1969-02-10", "1969-03-03", "candidates nominated"),
    ("Westminster 1964", 1964, "1964-10-15", "1964-10-01", "1964-10-20", "persons nominated"),
    ("Westminster 1970", 1970, "1970-06-18", "1970-06-04", "1970-06-22", "persons nominated"),
    ("Westminster 1979", 1979, "1979-05-03", "1979-04-19", "1979-05-07", "persons nominated"),
    ("Westminster 1983", 1983, "1983-06-09", "1983-05-25", "1983-06-13", "persons nominated"),
    ("Westminster 1987", 1987, "1987-06-11", "1987-05-28", "1987-06-15", "persons nominated"),
    ("Westminster 2005", 2005, "2005-05-05", "2005-04-20", "2005-05-10", "persons nominated"),
    ("Westminster 2010", 2010, "2010-05-06", "2010-04-22", "2010-05-10", "persons nominated"),
    ("Assembly 1973", 1973, "1973-06-28", "1973-06-14", "1973-07-02", "persons nominated"),
    ("Convention 1975", 1975, "1975-05-01", "1975-04-17", "1975-05-05", "persons nominated"),
    ("Assembly 2003", 2003, "2003-11-26", "2003-11-12", "2003-11-30", "persons nominated"),
    ("Assembly 2007", 2007, "2007-03-07", "2007-02-21", "2007-03-11", "persons nominated"),
    ("European 2009", 2009, "2009-06-04", "2009-05-21", "2009-06-08", "persons nominated"),
    ("Local 1973", 1973, "1973-05-30", "1973-05-16", "1973-06-03", "persons nominated"),
    ("Local 2005", 2005, "2005-05-05", "2005-04-20", "2005-05-10", "local persons nominated"),
    # Also search for elections we have partial Gazette data for
    ("Assembly 1982", 1982, "1982-10-20", "1982-10-06", "1982-10-24", "persons nominated"),
    ("Assembly 1998", 1998, "1998-06-25", "1998-06-11", "1998-06-29", "persons nominated"),
    ("Forum 1996", 1996, "1996-05-30", "1996-05-16", "1996-06-03", "persons nominated"),
    ("Westminster 1992", 1992, "1992-04-09", "1992-03-26", "1992-04-13", "persons nominated"),
    ("Westminster 1997", 1997, "1997-05-01", "1997-04-17", "1997-05-05", "persons nominated"),
]

OUT_DIR = Path("_tmp_bna")
OUT_DIR.mkdir(exist_ok=True)
STORAGE_STATE_PATH = OUT_DIR / "bna_storage_state.json"


def select_elections(arg: str | None):
    """Select elections by year or case-insensitive name fragment."""
    if not arg:
        return ELECTIONS, "all configured elections"

    arg = arg.strip()
    year_match = re.fullmatch(r"\d{4}", arg)
    if year_match:
        year = int(arg)
        matched = [e for e in ELECTIONS if e[1] == year]
        return matched, f"year {year}"

    needle = arg.lower()
    matched = [e for e in ELECTIONS if needle in e[0].lower()]
    return matched, f'name filter "{arg}"'


def save_storage_state(context):
    """Persist storage state for non-persistent fallback sessions."""
    try:
        context.storage_state(path=str(STORAGE_STATE_PATH))
    except Exception:
        pass


def launch_bna_context(playwright):
    """Launch a browser context, preferring the persistent logged-in profile.

    Some environments fail to reopen the persistent profile cleanly. Fall back
    to a normal context with saved storage state rather than aborting the run.
    """
    user_data = str(Path.home() / ".bna-playwright-profile")
    launch_kwargs = {
        "headless": False,
        "viewport": {"width": 1200, "height": 900},
    }

    # Skip persistent profile (known to crash in this environment).
    # Go straight to storage-state approach.
    browser = playwright.chromium.launch(headless=False)
    context_kwargs = {
        "viewport": {"width": 1200, "height": 900},
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    }
    if STORAGE_STATE_PATH.exists():
        context_kwargs["storage_state"] = str(STORAGE_STATE_PATH)
        print(f"Loading saved BNA session from {STORAGE_STATE_PATH}")
    context = browser.new_context(**context_kwargs)
    page = context.new_page()
    return context, page


def is_noninteractive():
    """Return True when automation should not block on manual login prompts."""
    return os.environ.get("BNA_NONINTERACTIVE") == "1" or not sys.stdin.isatty()


def run():
    from playwright.sync_api import sync_playwright

    filter_arg = sys.argv[1] if len(sys.argv) > 1 else None
    elections, filter_label = select_elections(filter_arg)
    print(f"Filtering to {filter_label}: {len(elections)} elections")
    if not elections:
        names = ", ".join(e[0] for e in ELECTIONS)
        raise SystemExit(f"No configured elections matched {filter_label}. Available: {names}")

    with sync_playwright() as p:
        context, page = launch_bna_context(p)

        # Check if logged in — retry to handle Cloudflare challenge
        page.goto("https://www.britishnewspaperarchive.co.uk", wait_until="networkidle")
        for attempt in range(5):
            time.sleep(5)
            content = page.content()
            if "SUBSCRIBED" in content:
                break
            title = page.title()
            if "Just a moment" in title:
                print(f"  Cloudflare challenge detected, waiting... (attempt {attempt+1})")
                time.sleep(5)
            else:
                break
        content = page.content()
        if "MY ACCOUNT (SUBSCRIBED)" not in content and "SUBSCRIBED" not in content:
            print("NOT LOGGED IN. Please log in to BNA in the browser window.")
            if is_noninteractive():
                raise SystemExit("No reusable BNA login is available in this environment.")
            print("Press Enter when logged in...")
            try:
                input()
            except EOFError:
                raise SystemExit("No reusable BNA login is available in this environment.")
            save_storage_state(context)

        all_results = []

        for name, year, poll_date, start, end, keywords in elections:
            print(f"\n{'='*60}")
            print(f"  {name} (polling day: {poll_date})")
            print(f"  Searching: {start} to {end}")
            print(f"{'='*60}")

            election_dir = OUT_DIR / name.replace(" ", "_")
            election_dir.mkdir(exist_ok=True)

            # Search BNA
            search_url = (
                f"https://www.britishnewspaperarchive.co.uk/search/results/"
                f"{start}/{end}?"
                f"basicsearch=%22{keywords.replace(' ', '%20')}%22"
                f"&phrasesearch={keywords.replace(' ', '%20')}"
                f"&exactsearch=true"
                f"&country=ireland"
                f"&retrievecountrycounts=false"
                f"&sortorder=dayearly"
            )

            page.goto(search_url)
            time.sleep(5)

            # Get result count
            try:
                result_text = page.text_content(".search-results-summary, .results-count, h2")
                print(f"  Results: {result_text}")
            except:
                pass

            # Extract all result items from the page
            results = []
            page_num = 1
            max_pages = 5  # Limit pages per election

            while page_num <= max_pages:
                # Get all article links on current page
                articles = page.query_selector_all("a[href*='/viewer/']")
                if not articles:
                    # Try alternative selectors
                    articles = page.query_selector_all(".search-result a, .result-row a")

                for article in articles:
                    href = article.get_attribute("href") or ""
                    text = article.text_content() or ""
                    if "/viewer/" in href and len(text.strip()) > 10:
                        results.append({
                            "url": f"https://www.britishnewspaperarchive.co.uk{href}" if href.startswith("/") else href,
                            "title": text.strip()[:200],
                        })

                # Check for next page
                next_btn = page.query_selector("a[rel='next'], .pagination-next a, a:has-text('Next')")
                if next_btn and page_num < max_pages:
                    next_btn.click()
                    time.sleep(3)
                    page_num += 1
                else:
                    break

            print(f"  Found {len(results)} article links")

            # Visit each article and extract OCR text
            for i, result in enumerate(results):
                url = result["url"]
                print(f"  [{i+1}/{len(results)}] {result['title'][:60]}...")

                try:
                    page.goto(url)
                    time.sleep(4)

                    # Extract OCR text from the article sidebar
                    ocr_text = ""
                    try:
                        # BNA shows OCR text in a textarea or div
                        ocr_el = page.query_selector("#articleOCR, .article-text, textarea[id*='ocr'], .ocr-text")
                        if ocr_el:
                            ocr_text = ocr_el.text_content() or ""
                    except:
                        pass

                    if not ocr_text:
                        # Try getting all text from the article panel
                        try:
                            panel = page.query_selector(".article-detail, .viewer-article-text, [class*='article']")
                            if panel:
                                ocr_text = panel.text_content() or ""
                        except:
                            pass

                    # Get page title for metadata
                    title = page.title()

                    # Extract date from URL
                    date_match = re.search(r"/(\d{8})/", url)
                    pub_date = ""
                    if date_match:
                        d = date_match.group(1)
                        pub_date = f"{d[:4]}-{d[4:6]}-{d[6:8]}"

                    result["ocr_text"] = ocr_text[:5000]
                    result["page_title"] = title
                    result["pub_date"] = pub_date

                    # Save individual article
                    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", result["title"][:50])
                    with open(election_dir / f"article_{i:03d}_{safe_name}.json", "w", encoding="utf-8") as f:
                        json.dump(result, f, indent=2, ensure_ascii=False)

                    # Take screenshot
                    page.screenshot(path=str(election_dir / f"screenshot_{i:03d}.png"))

                except Exception as e:
                    print(f"    Error: {e}")
                    result["error"] = str(e)

                time.sleep(2)  # Be polite

            # Save all results for this election
            with open(election_dir / "results.json", "w", encoding="utf-8") as f:
                json.dump(results, f, indent=2, ensure_ascii=False)

            all_results.extend(results)
            print(f"  Saved {len(results)} articles to {election_dir}")

        # Save master index
        with open(OUT_DIR / "bna_master_index.json", "w", encoding="utf-8") as f:
            json.dump(all_results, f, indent=2, ensure_ascii=False)

        print(f"\n{'='*60}")
        print(f"  COMPLETE: {len(all_results)} total articles found")
        print(f"{'='*60}")

        save_storage_state(context)
        context.close()


if __name__ == "__main__":
    run()
