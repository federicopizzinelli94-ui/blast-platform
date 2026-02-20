import requests
import re
import time
from urllib.parse import urljoin, urlparse


def _fetch_page_with_retry(url, headers, max_attempts=2, backoff_factor=1.0):
    """Fetch a single page with retry + exponential backoff."""
    last_error = None
    for attempt in range(max_attempts):
        try:
            response = requests.get(url, headers=headers, timeout=5)
            return response
        except requests.RequestException as e:
            last_error = e
            if attempt < max_attempts - 1:
                sleep_time = backoff_factor ** attempt
                time.sleep(sleep_time)
    return None  # Graceful degradation: return None instead of crashing


def extract_emails_from_url(url):
    """
    Visits a URL and extracts emails using regex from Home, Contact, and About pages.
    Resilient: retries failed pages and never crashes the caller pipeline.
    """
    print(f"🕷️  Crawling {url} for contacts...")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    found_emails = set()
    visited_urls = set()

    # Validation
    if not url.startswith("http"):
        url = "https://" + url

    base_domain = urlparse(url).netloc

    # Queue of pages to visit (Home + common contact pages)
    pages_to_visit = [url]

    # Common contact paths to try blindly if not found
    common_paths = [
        "/contatti", "/contacts", "/contact", "/chi-siamo", "/about-us",
        "/about", "/info", "/impressum", "/dove-siamo", "/sede",
        "/privacy", "/lavora-con-noi"
    ]
    for path in common_paths:
        pages_to_visit.append(urljoin(url, path))

    # Pattern for emails
    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'

    max_pages = 8 # Limit to avoid deep loops
    count = 0

    for page_url in pages_to_visit:
        if count >= max_pages:
            break
        if page_url in visited_urls:
            continue

        visited_urls.add(page_url)
        count += 1

        try:
            print(f"   🔎 Checking: {page_url}")
            response = _fetch_page_with_retry(page_url, headers)

            if response is None:
                print(f"      ⚠️  Skipped (unreachable after retry): {page_url}")
                continue

            # Allow redirects, but check domain
            if urlparse(response.url).netloc != base_domain:
                continue

            if response.status_code == 200:
                text = response.text
                emails = set(re.findall(email_pattern, text))

                # Filter junk
                valid = {e for e in emails if not e.endswith(('.png', '.jpg', '.jpeg', '.gif', '.js', '.css', '.svg', '.webp'))}

                if valid:
                    print(f"      ✨ Found: {valid}")
                    found_emails.update(valid)

        except Exception as e:
            # Catch-all: never crash the pipeline for email extraction
            print(f"      ⚠️  Unexpected error on {page_url}: {e}")

    results = list(found_emails)
    print(f"✅ Total unique emails found: {len(results)} -> {results}")
    return results


def extract_contacts_from_url(url):
    """
    Enhanced version: extracts both emails AND phone numbers.
    Returns { 'emails': [...], 'phones': [...] }
    Zero additional API cost — just regex on already-fetched pages.
    """
    print(f"🕷️  Crawling {url} for contacts (emails + phones)...")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }

    found_emails = set()
    found_phones = set()
    visited_urls = set()

    if not url.startswith("http"):
        url = "https://" + url

    base_domain = urlparse(url).netloc

    pages_to_visit = [url]
    common_paths = [
        "/contatti", "/contacts", "/contact", "/chi-siamo", "/about-us",
        "/about", "/info", "/impressum", "/dove-siamo", "/sede"
    ]
    for path in common_paths:
        pages_to_visit.append(urljoin(url, path))

    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    # Italian phone patterns: +39, 0X, 3X (mobile)
    phone_pattern = r'(?:\+39[\s.-]?)?(?:0[0-9]{1,3}|3[0-9]{2})[\s.-]?[0-9]{3,4}[\s.-]?[0-9]{3,4}'

    max_pages = 8
    count = 0

    for page_url in pages_to_visit:
        if count >= max_pages:
            break
        if page_url in visited_urls:
            continue

        visited_urls.add(page_url)
        count += 1

        try:
            response = _fetch_page_with_retry(page_url, headers)
            if response is None:
                continue
            if urlparse(response.url).netloc != base_domain:
                continue
            if response.status_code == 200:
                text = response.text

                # Emails
                emails = set(re.findall(email_pattern, text))
                valid_emails = {e for e in emails if not e.endswith(('.png', '.jpg', '.jpeg', '.gif', '.js', '.css', '.svg', '.webp'))}
                found_emails.update(valid_emails)

                # Phones
                phones = set(re.findall(phone_pattern, text))
                # Filter out numbers that are too short (likely not phones)
                valid_phones = {p.strip() for p in phones if len(re.sub(r'[\s.+-]', '', p)) >= 9}
                found_phones.update(valid_phones)

        except Exception:
            continue

    emails_list = list(found_emails)
    phones_list = list(found_phones)
    print(f"✅ Contacts found: {len(emails_list)} emails, {len(phones_list)} phones")
    return {'emails': emails_list, 'phones': phones_list}


if __name__ == "__main__":
    import sys
    url = sys.argv[1] if len(sys.argv) > 1 else "https://www.montina.com"
    result = extract_contacts_from_url(url)
    print(f"Emails: {result['emails']}")
    print(f"Phones: {result['phones']}")
