// Ordnance Survey of Northern Ireland LiDAR and the island-wide terrain built from it.
import { definePlugin } from '../../intake/lib/plugins.mjs';

export default definePlugin({
  id: 'osni',
  title: 'OSNI LiDAR hillshades and the island terrain',
  kinds: ['maps'],
  personalData: { contains: false, handling: 'none' },
  sources: [
    { id: 'osni-river-basin-lidar', title: 'OSNI Open Data: River Basin LIDAR, DTMs and DSMs', publisher: 'Ordnance Survey of Northern Ireland (OpenDataNI)', url: 'https://www.opendatani.gov.uk/', rights: 'OGL', licence: 'Open Government Licence' },
    { id: 'copernicus-glo30', title: 'Copernicus GLO-30 Digital Elevation Model', publisher: 'European Space Agency', rights: 'CC-BY', licence: 'Copernicus DEM licence (free use with attribution)' },
  ],
  inputs: {
    block: { description: 'an unzipped River Basin LiDAR block' },
    outDir: { description: 'the tile pyramid folder to write' },
    glo: { description: 'the GLO-30 VRT' },
    work: { description: 'a work folder' },
  },
  steps: {
    'river-basin-hillshade': {
      title: 'Build a 1 m hillshade tile pyramid from one River Basin LiDAR block',
      argv: ['bash', 'scripts/ingest/osni/build_river_basin_hillshade.sh', '{input:block}', '{input:outDir}'],
    },
    'island-terrain': {
      title: 'Fill the holes in ireland-terrain-3d from Copernicus GLO-30 (give --stage base|deep after --)',
      argv: ['python', 'scripts/ingest/osni/rebuild_island_terrain.py', '--glo', '{input:glo}', '--work', '{input:work}'],
      network: true,
    },
  },
});
