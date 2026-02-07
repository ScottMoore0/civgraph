/**
 * NI Boundaries - Data Service
 * Handles loading and querying the maps/books database
 */

class DataService {
  constructor() {
    this.maps = null;
    this.books = null;
    this.geographies = null;
    this.baseUrl = '';
    this.fuse = null;
  }

  /**
   * Initialize the data service by loading all database files
   */
  async init() {
    const [mapsData, booksData, geographiesData] = await Promise.all([
      this.loadJson('data/database/maps.json'),
      this.loadJson('data/database/books.json'),
      this.loadJson('data/database/geographies.json')
    ]);

    this.maps = mapsData;
    this.books = booksData;
    this.geographies = geographiesData;

    // Initialize Fuse.js for fuzzy search
    this.initFuseSearch();

    console.log(`[DataService] Loaded ${this.maps.maps.length} maps, ${this.books.books.length} books`);
    return this;
  }

  /**
   * Initialize Fuse.js search index
   */
  initFuseSearch() {
    if (typeof Fuse !== 'undefined' && this.maps?.maps) {
      this.fuse = new Fuse(this.maps.maps, {
        keys: [
          { name: 'name', weight: 2 },
          { name: 'keywords', weight: 1.5 },
          { name: 'provider', weight: 1 },
          { name: 'category', weight: 0.5 }
        ],
        threshold: 0.4,
        includeScore: true,
        ignoreLocation: true
      });
      console.log('[DataService] Fuse.js search initialized');
    }
  }

  /**
   * Load and parse a JSON file
   */
  async loadJson(url) {
    const response = await fetch(this.baseUrl + url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`);
    }
    return response.json();
  }

  // ============================================
  // Map Queries
  // ============================================

  /**
   * Get all maps (excluding hidden ones)
   */
  getAllMaps() {
    const maps = this.maps?.maps || [];
    return maps.filter(m => !m.hidden);
  }

  /**
   * Get a map by ID
   * Also searches within variants - if a variant is found, returns it merged with parent properties
   */
  getMapById(id) {
    // First check top-level maps
    const directMatch = this.getAllMaps().find(m => m.id === id);
    if (directMatch) return directMatch;

    // Search within variants
    for (const map of this.getAllMaps()) {
      if (map.variants) {
        const variant = map.variants.find(v => v.id === id);
        if (variant) {
          // Merge variant with parent map properties
          return {
            ...map,
            ...variant,
            parentId: map.id,
            style: variant.style || map.style,
            labelProperty: variant.labelProperty || map.labelProperty,
            priorityProperty: variant.priorityProperty || map.priorityProperty,
            name: variant.label || variant.id,
            variants: undefined  // Don't include parent's variants in the merged result
          };
        }
      }
    }
    return undefined;
  }

  /**
   * Get maps by category or group
   * If categoryId matches a category.id, filters by that category
   * If categoryId matches a group name (lowercase), filters by all categories in that group
   */
  getMapsByCategory(categoryId) {
    if (categoryId === 'all') return this.getAllMaps();

    // Check if this is a group ID (lowercase of a group name)
    const categories = this.maps?.categories || [];
    const groupNames = ['communities', 'history', 'elections-and-government', 'public-services', 'physical-geography', 'built-environment'];

    if (groupNames.includes(categoryId)) {
      // Convert ID back to group name for matching
      const groupName = categoryId
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      // Get all category IDs that belong to this group
      const categoryIdsInGroup = categories
        .filter(c => c.group === groupName)
        .map(c => c.id);

      return this.getAllMaps().filter(m => categoryIdsInGroup.includes(m.category));
    }

    // Otherwise, filter by specific category
    return this.getAllMaps().filter(m => m.category === categoryId);
  }

  /**
   * Search maps by query string (uses Fuse.js for fuzzy matching)
   */
  searchMaps(query) {
    if (!query || !query.trim()) return this.getAllMaps();

    // Use Fuse.js if available
    if (this.fuse) {
      const results = this.fuse.search(query.trim());
      return results.map(r => r.item);
    }

    // Fallback to simple search
    const terms = query.toLowerCase().trim().split(/\s+/);
    return this.getAllMaps().filter(map => {
      const searchText = [
        map.name,
        map.category,
        ...(map.keywords || []),
        ...(map.provider || [])
      ].join(' ').toLowerCase();

      return terms.every(term => searchText.includes(term));
    });
  }

  /**
   * Get all map categories (excluding hidden ones)
   */
  getMapCategories() {
    const categories = this.maps?.categories || [];
    return categories.filter(c => !c.hidden);
  }

  /**
   * Get all classes (groupings of related maps), excluding hidden ones
   * Use getAllClasses() if you need hidden classes (e.g., for C1 rendering)
   */
  getClasses() {
    const classes = this.maps?.classes || [];
    return classes.filter(cls => !cls.hidden);
  }

  /**
   * Get all classes including hidden ones (for internal use by C1s)
   */
  getAllClasses() {
    return this.maps?.classes || [];
  }

  /**
   * Get all C1s (top-level class groups containing C2s)
   */
  getC1s() {
    return this.maps?.c1s || [];
  }

  /**
   * Get all data (for Explore tab)
   * Returns categories, classes, maps, and books
   */
  getData() {
    // Return null if data is not yet loaded
    if (!this.maps) return null;

    return {
      categories: this.getMapCategories(),
      classes: this.getClasses(),
      maps: this.getAllMaps(),
      books: this.getAllBooks()
    };
  }

  /**
   * Get the default-on maps
   */
  getDefaultMaps() {
    return this.getAllMaps().filter(m => m.defaultOn);
  }

  /**
   * Get the primary FGB file path for a map
   * Handles cloned maps by resolving to the source map's files
   */
  getMapFilePath(map) {
    if (!map) return null;

    // If this is a cloned map, get files from the source map
    if (map.cloneOf) {
      const sourceMap = this.getMapById(map.cloneOf);
      if (sourceMap?.files) {
        return sourceMap.files.fgb || sourceMap.files.geojson || Object.values(sourceMap.files)[0];
      }
    }

    if (!map.files) return null;
    return map.files.fgb || map.files.geojson || Object.values(map.files)[0];
  }

  /**
   * Get all available file formats for a map
   */
  getMapFormats(map) {
    if (!map?.files) return [];
    return Object.entries(map.files)
      .filter(([_, path]) => path)
      .map(([format, path]) => ({ format, path }));
  }

  // ============================================
  // Book Queries
  // ============================================

  /**
   * Get all books
   */
  getAllBooks() {
    return this.books?.books || [];
  }

  /**
   * Get a book by ID
   */
  getBookById(id) {
    return this.getAllBooks().find(b => b.id === id);
  }

  /**
   * Get books by category
   */
  getBooksByCategory(categoryId) {
    if (categoryId === 'all') return this.getAllBooks();
    return this.getAllBooks().filter(b => b.category === categoryId);
  }

  /**
   * Search books by query string
   */
  searchBooks(query) {
    if (!query || !query.trim()) return this.getAllBooks();

    const terms = query.toLowerCase().trim().split(/\s+/);
    return this.getAllBooks().filter(book => {
      const searchText = [
        book.title,
        ...(book.authors || []),
        ...(book.keywords || [])
      ].join(' ').toLowerCase();

      return terms.every(term => searchText.includes(term));
    });
  }

  /**
   * Get all book categories
   */
  getBookCategories() {
    return this.books?.categories || [];
  }

  /**
   * Get books related to a map
   */
  getBooksForMap(mapId) {
    return this.getAllBooks().filter(b =>
      b.relatedMaps && b.relatedMaps.includes(mapId)
    );
  }

  // ============================================
  // Geography Queries
  // ============================================

  /**
   * Get all geography types
   */
  getGeographyTypes() {
    return this.geographies?.geographyTypes || [];
  }

  /**
   * Get all hierarchies
   */
  getHierarchies() {
    return this.geographies?.hierarchies || {};
  }

  // ============================================
  // Time-Series Chain Queries
  // ============================================

  /**
   * Get all time-series chains
   */
  getTimeSeriesChains() {
    return this.maps?.timeSeriesChains || [];
  }

  /**
   * Find which chain a class belongs to
   */
  getChainForClass(classId) {
    const chains = this.getTimeSeriesChains();
    for (const chain of chains) {
      // Check direct classIds
      if (chain.classIds?.includes(classId)) {
        return chain;
      }
      // Check segments
      if (chain.segments) {
        for (const segment of chain.segments) {
          if (segment.classIds?.includes(classId)) {
            return chain;
          }
        }
      }
      // Check parallel columns
      if (chain.columns) {
        for (const col of chain.columns) {
          if (col.classIds?.includes(classId)) {
            return chain;
          }
        }
      }
      // Check predecessor
      if (chain.predecessor?.classIds?.includes(classId)) {
        return chain;
      }
    }
    return null;
  }

  /**
   * Find which chain a map belongs to (by looking up its class)
   */
  getChainForMap(mapId) {
    const map = this.getMapById(mapId);
    if (!map) return null;

    // Find the class that contains this map (use ALL classes including hidden ones)
    const classes = this.getAllClasses();
    for (const cls of classes) {
      if (cls.maps?.includes(mapId)) {
        return this.getChainForClass(cls.id);
      }
    }
    return null;
  }

  /**
   * Get all class IDs that belong to a chain (including all segments, columns, predecessors)
   */
  getAllClassIdsInChain(chain) {
    const classIds = new Set();

    if (chain.classIds) {
      chain.classIds.forEach(id => classIds.add(id));
    }
    if (chain.segments) {
      chain.segments.forEach(seg => {
        seg.classIds?.forEach(id => classIds.add(id));
      });
    }
    if (chain.columns) {
      chain.columns.forEach(col => {
        col.classIds?.forEach(id => classIds.add(id));
      });
    }
    if (chain.predecessor?.classIds) {
      chain.predecessor.classIds.forEach(id => classIds.add(id));
    }

    return [...classIds];
  }

  /**
   * Parse a map's date field to a timestamp
   * Handles formats: "YYYY", "YYYY-MM-DD", "DD MMM YYYY"
   */
  parseMapDate(dateStr) {
    if (!dateStr) return null;

    // Year only: "1972"
    if (/^\d{4}$/.test(dateStr)) {
      return new Date(`${dateStr}-01-01`).getTime();
    }

    // ISO format: "1972-01-01"
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return new Date(dateStr).getTime();
    }

    // Try generic parse
    const parsed = Date.parse(dateStr);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * Get all maps in a chain, sorted by date (newest first)
   */
  getMapsInChain(chain) {
    const classIds = this.getAllClassIdsInChain(chain);
    const classes = this.getAllClasses();
    const maps = [];

    for (const classId of classIds) {
      const cls = classes.find(c => c.id === classId);
      if (cls?.maps) {
        for (const mapId of cls.maps) {
          const map = this.getMapById(mapId);
          if (map) {
            maps.push({
              map,
              classId,
              timestamp: this.parseMapDate(map.date)
            });
          }
        }
      }
    }

    // Sort by date, newest first
    return maps.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  /**
   * Get all unique dates from maps in the given chains
   */
  getApplicableDates(chains) {
    const timestamps = new Set();

    for (const chain of chains) {
      const maps = this.getMapsInChain(chain);
      maps.forEach(m => {
        if (m.timestamp) timestamps.add(m.timestamp);
      });
    }

    // Sort timestamps (newest first)
    return [...timestamps].sort((a, b) => b - a);
  }

  /**
   * Given active map IDs and a target date, find the equivalent maps for that date
   * Returns an object mapping old mapId -> new mapId (or null if no equivalent)
   */
  getEquivalentMapsForDate(activeMapIds, targetTimestamp) {
    const result = {};

    console.log('[DataService] getEquivalentMapsForDate - activeMapIds:', activeMapIds, 'targetTimestamp:', targetTimestamp);

    for (const mapId of activeMapIds) {
      const chain = this.getChainForMap(mapId);
      console.log('[DataService] Map:', mapId, 'chain:', chain?.id || 'none');
      if (!chain) {
        // Not part of a time-series, keep as-is
        result[mapId] = mapId;
        continue;
      }

      // Find the map in this chain that was active at the target date
      const mapsInChain = this.getMapsInChain(chain);
      console.log('[DataService] mapsInChain:', mapsInChain.map(m => ({ id: m.map.id, timestamp: m.timestamp })));

      // Find the map whose date is closest to but not after the target date
      let bestMatch = null;
      for (const { map, timestamp } of mapsInChain) {
        if (timestamp && timestamp <= targetTimestamp) {
          if (!bestMatch || timestamp > bestMatch.timestamp) {
            bestMatch = { map, timestamp };
          }
        }
      }

      console.log('[DataService] bestMatch for', mapId, ':', bestMatch ? bestMatch.map.id : 'null');
      result[mapId] = bestMatch ? bestMatch.map.id : null;
    }

    return result;
  }
}

// Export singleton instance
const dataService = new DataService();
export default dataService;
