const bookConfigs = [
  {
    name: "Provisional Recommendations: District Electoral Areas",
    file: "https://dn721701.ca.archive.org/0/items/dea-prov-1-compressed-2/DEA%20Prov%201_compressed%202.pdf",
    category: "Reports",
    authors: ["District Electoral Areas Commissioner NI"],
    date: "August 1992"
  },
  {
    name: "Revised Recommendations: Local Government Boundaries",
    file: "https://ia801905.us.archive.org/28/items/revised-recommendations-local-government-boundaries-1992/Revised%20Recommendations%2C%20Local%20Government%20Boundaries%20%281992%29.pdf",
    category: "History",
    authors: ["Local Government Boundaries Commissioner NI"],
    date: "February 1992"
  },
  {
    name: "Final Recommendations: District Electoral Areas",
    file: "https://dn720703.ca.archive.org/0/items/1992-dea-commissioner-report/1992%20DEA%20Commissioner%20Report.pdf",
    category: "Science",
    authors: ["Local Government Boundaries Commissioner NI"],
    date: "25 November 1992"
  },
  {
    name: "Revised Recommendations: Local Government Boundaries",
    file: "https://ia801405.us.archive.org/26/items/harrison-1-merged-compressed-2/Harrison%201-merged-compressed%202.pdf",
    category: "Policies",
    authors: ["Local Government Boundaries Commissioner NI"],
    date: "January 1984"
  }
];

(function(){
  let currentCategory = 'All';
  let currentAuthor = 'All';

  const booksUI = {
    cardContainer: null,
    categoryContainer: null,
    authorContainer: null,
    searchInput: null,
    cardClickHandler: null,
    categoryHandler: null,
    authorHandler: null,
    searchHandler: null
  };

  function humanFileSize(bytes){
    const kb = 1024;
    const mb = kb*1024;
    if(bytes >= mb) return `${Math.round(bytes/mb)} MB`;
    if(bytes >= kb) return `${Math.round(bytes/kb)} KB`;
    return `${bytes} B`;
  }

  function fetchFileSize(url){
    return fetch(url, {method: 'HEAD'})
      .then(r => r.ok ? Number(r.headers.get('Content-Length')) : NaN)
      .catch(() => NaN);
  }

  function createBookCards(container){
    container.innerHTML = '';

    bookConfigs.forEach(cfg => {
      const col = document.createElement('div');
      col.className = 'col-md-3 mb-3';
      col.dataset.category = cfg.category || 'Other';
      col.dataset.author = (cfg.authors || ['Unknown']).join(',');
      col.dataset.name = cfg.name;
      col.dataset.date = cfg.date || '';
      const authors = (cfg.authors || ['Unknown']).join(', ');
      const date = cfg.date ? `<div class="text-muted small">${cfg.date}</div>` : '';
      col.innerHTML = `
        <div class="card h-100">
          <div class="card-body">
            <h5 class="card-title">${cfg.name}</h5>
            <h6 class="card-subtitle mb-2 text-muted">${authors}</h6>
            ${date}
            <div class="btn-group" role="group">
              <a class="btn btn-sm btn-outline-primary" href="${cfg.file}" target="_blank" title="View PDF"><i class="bi bi-eye"></i></a>
              <a class="btn btn-sm btn-outline-primary" href="${cfg.file}" download title="Download PDF"><i class="bi bi-download"></i></a>
              <button class="btn btn-sm btn-outline-primary copy-btn" data-url="${cfg.file}" title="Copy link"><i class="bi bi-clipboard"></i></button>
            </div>
            <div class="mt-2 file-size text-muted small">Loading size...</div>
          </div>
        </div>`;
      container.appendChild(col);

      const sizeEl = col.querySelector('.file-size');
      fetchFileSize(cfg.file).then(size => {
        if(!isNaN(size)) sizeEl.textContent = humanFileSize(size);
        else sizeEl.textContent = 'Size unavailable';
      });
    });

    if(booksUI.cardClickHandler){
      container.removeEventListener('click', booksUI.cardClickHandler);
    }

    booksUI.cardClickHandler = e => {
      const button = e.target.closest('.copy-btn');
      if(button){
        const url = button.dataset.url;
        navigator.clipboard.writeText(url);
      }
    };

    container.addEventListener('click', booksUI.cardClickHandler);
  }

  function createCategoryButtons(container){
    container.innerHTML = '';

    const categories = new Set(bookConfigs.map(b => b.category || 'Other'));
    const allBtn = document.createElement('button');
    allBtn.className = 'btn btn-sm btn-outline-primary me-2 category-btn';
    allBtn.textContent = 'All';
    allBtn.dataset.category = 'All';
    container.appendChild(allBtn);

    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-outline-primary me-2 category-btn';
      btn.textContent = cat;
      btn.dataset.category = cat;
      container.appendChild(btn);
    });

    if(booksUI.categoryHandler){
      container.removeEventListener('click', booksUI.categoryHandler);
    }

    booksUI.categoryHandler = e => {
      const btn = e.target.closest('.category-btn');
      if(btn){
        currentCategory = btn.dataset.category;
        filterBookCards();
      }
    };

    container.addEventListener('click', booksUI.categoryHandler);
  }

  function createAuthorButtons(container){
    container.innerHTML = '';

    const authors = new Set();
    bookConfigs.forEach(cfg => (cfg.authors || ['Unknown']).forEach(a => authors.add(a)));
    const allBtn = document.createElement('button');
    allBtn.className = 'btn btn-sm btn-outline-primary me-2 author-btn';
    allBtn.textContent = 'All';
    allBtn.dataset.author = 'All';
    container.appendChild(allBtn);

    authors.forEach(author => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-outline-primary me-2 author-btn';
      btn.textContent = author;
      btn.dataset.author = author;
      container.appendChild(btn);
    });

    if(booksUI.authorHandler){
      container.removeEventListener('click', booksUI.authorHandler);
    }

    booksUI.authorHandler = e => {
      const btn = e.target.closest('.author-btn');
      if(btn){
        currentAuthor = btn.dataset.author;
        filterBookCards();
      }
    };

    container.addEventListener('click', booksUI.authorHandler);
  }

  function filterBookCards(){
    if(!booksUI.cardContainer || !booksUI.searchInput) return;
    const term = booksUI.searchInput.value.toLowerCase();
    booksUI.cardContainer.querySelectorAll(':scope > div').forEach(col => {
      const name = col.dataset.name.toLowerCase();
      const cat = col.dataset.category;
      const authorList = col.dataset.author.split(',');
      const matchCat = currentCategory === 'All' || cat === currentCategory;
      const matchSearch = name.includes(term);
      const matchAuthor = currentAuthor === 'All' || authorList.includes(currentAuthor);
      col.style.display = matchCat && matchAuthor && matchSearch ? '' : 'none';
    });
  }

  function setupSearch(){
    if(!booksUI.searchInput) return;

    if(booksUI.searchHandler){
      booksUI.searchInput.removeEventListener('input', booksUI.searchHandler);
    }

    booksUI.searchHandler = () => {
      filterBookCards();
    };

    booksUI.searchInput.addEventListener('input', booksUI.searchHandler);
  }

  function initializeBooksPage(){
    booksUI.cardContainer = document.getElementById('cardContainer');
    booksUI.categoryContainer = document.getElementById('categoryButtons');
    booksUI.authorContainer = document.getElementById('authorButtons');
    booksUI.searchInput = document.getElementById('search');

    if(!booksUI.cardContainer || !booksUI.categoryContainer || !booksUI.authorContainer || !booksUI.searchInput){
      return;
    }

    currentCategory = 'All';
    currentAuthor = 'All';

    createBookCards(booksUI.cardContainer);
    createCategoryButtons(booksUI.categoryContainer);
    createAuthorButtons(booksUI.authorContainer);
    filterBookCards();
    setupSearch();
  }

  window.initializeBooksPage = initializeBooksPage;
})();
