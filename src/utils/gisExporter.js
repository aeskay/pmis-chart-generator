/**
 * gisExporter.js
 * Comprehensive GIS export engine for TxDOT PMIS sections.
 * Generates:
 *  - Google Earth KML (.kml) with 3D/2D polylines, rich HTML balloon popups, and marker pins
 *  - Master combined KML with nested folders for Google Earth
 *  - GeoJSON FeatureCollections (.geojson) for ArcGIS, QGIS, and web mapping
 *  - ZIP bundles containing individual KMLs per section + combined KML + GeoJSON
 */

import JSZip from 'jszip';

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeXml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeFilename(name) {
  return String(name || 'section')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_');
}

/**
 * Convert standard #RRGGBB hex color to KML aabbggrr format
 */
function hexToKmlColor(hex, alpha = 'ff') {
  if (!hex || typeof hex !== 'string') return `${alpha}ffffff`;
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map(c => c + c).join('');
  }
  if (clean.length !== 6) return `${alpha}ffffff`;
  const r = clean.substring(0, 2);
  const g = clean.substring(2, 4);
  const b = clean.substring(4, 6);
  // KML order: AABBGGRR
  return `${alpha}${b}${g}${r}`.toLowerCase();
}

/**
 * Get color based on Condition Score
 */
function getConditionScoreColor(score) {
  if (score === null || score === undefined || isNaN(score)) return '#64748b';
  const num = parseFloat(score);
  if (num >= 90) return '#10b981'; // Very Good (Green)
  if (num >= 70) return '#3b82f6'; // Good (Blue)
  if (num >= 50) return '#f59e0b'; // Fair (Amber)
  if (num >= 35) return '#f97316'; // Poor (Orange)
  return '#ef4444';                // Very Poor (Red)
}

function getConditionRating(score) {
  if (score === null || score === undefined || isNaN(score)) return 'N/A';
  const num = parseFloat(score);
  if (num >= 90) return 'Very Good (90–100)';
  if (num >= 70) return 'Good (70–89)';
  if (num >= 50) return 'Fair (50–69)';
  if (num >= 35) return 'Poor (35–49)';
  return 'Very Poor (1–34)';
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ── HTML Balloon Generator for Google Earth ─────────────────────────────────

function generateBalloonHtml(section, roadbedLetter, roadbedData) {
  const slab = section.slabTh ?? section.oldSlabTh;
  const slabDisplay = slab !== null && slab !== undefined && String(slab).trim() !== '' ? `${slab}"` : 'N/A';
  const csjDisplay = section.csj || 'N/A';
  const countyDisplay = section.countyName ? `${section.countyName} County` : 'N/A';
  const bedTitle = roadbedLetter === 'R'
    ? 'Roadbed R (Inventory / North / East)'
    : roadbedLetter === 'L'
    ? 'Roadbed L (Opposing / South / West)'
    : 'Roadbed KG (Undivided)';

  const cond = section.latestCondition ?? section.conditionScore;
  const dist = section.latestDistress ?? section.distressScore;
  const ride = section.latestRide ?? section.rideScore;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #1e293b; max-width: 360px; line-height: 1.45;">
      <div style="background: #1e3a8a; color: #ffffff; padding: 10px 12px; border-radius: 6px 6px 0 0;">
        <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #ffffff;">
          ${escapeXml(section.highway || 'Highway')} — Section ${escapeXml(section.id)}
        </h3>
        <div style="font-size: 11px; opacity: 0.9; margin-top: 2px;">
          ${escapeXml(bedTitle)}
        </div>
      </div>
      
      <div style="padding: 10px 12px; background: #ffffff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 6px 6px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 0; color: #64748b; width: 45%;">Highway / County</td>
            <td style="padding: 4px 0; font-weight: 600; text-align: right;">${escapeXml(section.highway || '—')} • ${escapeXml(countyDisplay)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 0; color: #64748b;">CSJ / Control Section</td>
            <td style="padding: 4px 0; font-family: monospace; font-weight: 600; text-align: right;">${escapeXml(csjDisplay)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 0; color: #64748b;">Reference Markers</td>
            <td style="padding: 4px 0; font-weight: 600; text-align: right;">TRM ${escapeXml(section.beginTrm ?? '—')} → ${escapeXml(section.endTrm ?? '—')}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 0; color: #64748b;">Distance From Origin</td>
            <td style="padding: 4px 0; font-weight: 600; text-align: right;">DFO ${escapeXml(section.beginDfo ?? '—')} → ${escapeXml(section.endDfo ?? '—')}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 0; color: #64748b;">Slab Thickness</td>
            <td style="padding: 4px 0; font-weight: 600; text-align: right;">${escapeXml(slabDisplay)}</td>
          </tr>
          ${roadbedData.lengthMiles ? `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 0; color: #64748b;">Segment Length</td>
            <td style="padding: 4px 0; font-weight: 600; text-align: right;">${escapeXml(roadbedData.lengthMiles)} miles</td>
          </tr>` : ''}
          ${cond !== undefined ? `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 0; color: #64748b;">Condition Score</td>
            <td style="padding: 4px 0; font-weight: 700; color: #10b981; text-align: right;">${escapeXml(cond)} (${escapeXml(getConditionRating(cond))})</td>
          </tr>` : ''}
          ${dist !== undefined ? `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 0; color: #64748b;">Distress Score</td>
            <td style="padding: 4px 0; font-weight: 600; text-align: right;">${escapeXml(dist)}</td>
          </tr>` : ''}
          ${ride !== undefined ? `
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 4px 0; color: #64748b;">Ride Score</td>
            <td style="padding: 4px 0; font-weight: 600; text-align: right;">${escapeXml(ride)}</td>
          </tr>` : ''}
          ${roadbedData.routeId ? `
          <tr>
            <td style="padding: 4px 0; color: #94a3b8; font-size: 11px;">TxDOT Roadway ID</td>
            <td style="padding: 4px 0; color: #94a3b8; font-size: 11px; font-family: monospace; text-align: right;">${escapeXml(roadbedData.routeId)}</td>
          </tr>` : ''}
        </table>
      </div>
    </div>
  `.trim();
}

// ── KML Geometry Builders ───────────────────────────────────────────────────

function coordsToKmlCoordinatesString(coordsList) {
  // coordsList is [[lat, lng], [lat, lng], ...]
  // KML requires "lng,lat,0" separated by spaces or newlines
  return coordsList
    .map(pt => `${pt[1].toFixed(7)},${pt[0].toFixed(7)},0`)
    .join(' ');
}

/**
 * Generate KML content for a single Section
 */
export function buildSectionKml(section, options = {}) {
  const {
    colorMode = 'roadbed', // 'roadbed' | 'condition'
    roadbeds = 'both',      // 'both' | 'R' | 'L'
    includePins = true,
  } = options;

  const c = section.coordinates || {};
  const beds = [];
  if ((roadbeds === 'both' || roadbeds === 'R') && c.R?.available) {
    beds.push({ letter: 'R', data: c.R, label: 'Roadbed R (Inventory)' });
  }
  if ((roadbeds === 'both' || roadbeds === 'L') && c.L?.available) {
    beds.push({ letter: 'L', data: c.L, label: 'Roadbed L (Opposing)' });
  }

  // Determine line colors
  const cond = section.latestCondition ?? section.conditionScore;
  const condHex = getConditionScoreColor(cond);

  const colorR = colorMode === 'condition' ? hexToKmlColor(condHex) : hexToKmlColor('#f97316'); // Orange
  const colorL = colorMode === 'condition' ? hexToKmlColor(condHex) : hexToKmlColor('#0ea5e9'); // Sky Blue

  let placemarksXml = '';

  beds.forEach(({ letter, data, label }) => {
    let latLngs = [];
    if (data.path && data.path.length > 1) {
      latLngs = data.path.map(p => [p[0], p[1]]);
    } else if (data.begin && data.end) {
      latLngs = [data.begin, data.end];
    }
    if (latLngs.length < 2) return;

    const balloonContent = generateBalloonHtml(section, letter, data);
    const styleId = letter === 'R' ? 'style_roadbed_r' : 'style_roadbed_l';
    const coordsStr = coordsToKmlCoordinatesString(latLngs);

    placemarksXml += `
      <Placemark id="sec_${escapeXml(section.id)}_bed_${letter}">
        <name>${escapeXml(section.highway || 'Highway')} - Sec ${escapeXml(section.id)} (${letter})</name>
        <styleUrl>#${styleId}</styleUrl>
        <description><![CDATA[${balloonContent}]]></description>
        <LineString>
          <extrude>0</extrude>
          <tessellate>1</tessellate>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>${coordsStr}</coordinates>
        </LineString>
      </Placemark>
    `;

    // Reference Marker Pins
    if (includePins && data.begin && data.end) {
      placemarksXml += `
        <Placemark id="pin_start_${escapeXml(section.id)}_${letter}">
          <name>Start: TRM ${escapeXml(section.beginTrm ?? '')} (${letter})</name>
          <styleUrl>#style_pin_start</styleUrl>
          <description><![CDATA[<b>Beginning Reference Marker:</b> TRM ${escapeXml(section.beginTrm ?? '—')}<br/><b>DFO:</b> ${escapeXml(section.beginDfo ?? '—')}]]></description>
          <Point>
            <coordinates>${data.begin[1].toFixed(7)},${data.begin[0].toFixed(7)},0</coordinates>
          </Point>
        </Placemark>
        <Placemark id="pin_end_${escapeXml(section.id)}_${letter}">
          <name>End: TRM ${escapeXml(section.endTrm ?? '')} (${letter})</name>
          <styleUrl>#style_pin_end</styleUrl>
          <description><![CDATA[<b>Ending Reference Marker:</b> TRM ${escapeXml(section.endTrm ?? '—')}<br/><b>DFO:</b> ${escapeXml(section.endDfo ?? '—')}]]></description>
          <Point>
            <coordinates>${data.end[1].toFixed(7)},${data.end[0].toFixed(7)},0</coordinates>
          </Point>
        </Placemark>
      `;
    }
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Section ${escapeXml(section.id)} - ${escapeXml(section.highway || '')}</name>
    <description>TxDOT PMIS Section ${escapeXml(section.id)} on ${escapeXml(section.highway || '')} generated by PMIS Chart Studio</description>
    
    <!-- Roadbed Styles -->
    <Style id="style_roadbed_r">
      <LineStyle>
        <color>${colorR}</color>
        <width>4</width>
      </LineStyle>
    </Style>
    <Style id="style_roadbed_l">
      <LineStyle>
        <color>${colorL}</color>
        <width>4</width>
      </LineStyle>
    </Style>
    <Style id="style_pin_start">
      <IconStyle>
        <color>ff00ff00</color>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="style_pin_end">
      <IconStyle>
        <color>ff0000ff</color>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href>
        </Icon>
      </IconStyle>
    </Style>

    <Folder>
      <name>Section ${escapeXml(section.id)} (${escapeXml(section.highway || '')})</name>
      ${placemarksXml}
    </Folder>
  </Document>
</kml>`;
}

/**
 * Generate Master Combined KML for multiple sections
 */
export function buildCombinedKml(sections, options = {}) {
  const {
    projectName = 'PMIS Project Sections',
    colorMode = 'roadbed',
    roadbeds = 'both',
    includePins = true,
  } = options;

  let foldersXml = '';

  (sections || []).forEach(section => {
    const c = section.coordinates || {};
    const beds = [];
    if ((roadbeds === 'both' || roadbeds === 'R') && c.R?.available) {
      beds.push({ letter: 'R', data: c.R, label: 'Roadbed R' });
    }
    if ((roadbeds === 'both' || roadbeds === 'L') && c.L?.available) {
      beds.push({ letter: 'L', data: c.L, label: 'Roadbed L' });
    }
    if (beds.length === 0) return;

    const cond = section.latestCondition ?? section.conditionScore;
    const condHex = getConditionScoreColor(cond);
    const colorR = colorMode === 'condition' ? hexToKmlColor(condHex) : hexToKmlColor('#f97316');
    const colorL = colorMode === 'condition' ? hexToKmlColor(condHex) : hexToKmlColor('#0ea5e9');

    let sectionPlacemarks = '';

    beds.forEach(({ letter, data, label }) => {
      let latLngs = [];
      if (data.path && data.path.length > 1) {
        latLngs = data.path.map(p => [p[0], p[1]]);
      } else if (data.begin && data.end) {
        latLngs = [data.begin, data.end];
      }
      if (latLngs.length < 2) return;

      const balloonContent = generateBalloonHtml(section, letter, data);
      const coordsStr = coordsToKmlCoordinatesString(latLngs);
      const styleId = colorMode === 'condition'
        ? `style_cond_${escapeXml(section.id)}`
        : (letter === 'R' ? 'style_roadbed_r' : 'style_roadbed_l');

      sectionPlacemarks += `
        <Placemark id="sec_${escapeXml(section.id)}_bed_${letter}">
          <name>${escapeXml(section.highway || 'Highway')} - Sec ${escapeXml(section.id)} (${letter})</name>
          <styleUrl>#${styleId}</styleUrl>
          <description><![CDATA[${balloonContent}]]></description>
          <LineString>
            <extrude>0</extrude>
            <tessellate>1</tessellate>
            <altitudeMode>clampToGround</altitudeMode>
            <coordinates>${coordsStr}</coordinates>
          </LineString>
        </Placemark>
      `;

      if (includePins && data.begin && data.end) {
        sectionPlacemarks += `
          <Placemark id="pin_start_${escapeXml(section.id)}_${letter}">
            <name>Sec ${escapeXml(section.id)} Start (${letter})</name>
            <styleUrl>#style_pin_start</styleUrl>
            <description><![CDATA[TRM ${escapeXml(section.beginTrm ?? '—')}<br/>DFO ${escapeXml(section.beginDfo ?? '—')}]]></description>
            <Point>
              <coordinates>${data.begin[1].toFixed(7)},${data.begin[0].toFixed(7)},0</coordinates>
            </Point>
          </Placemark>
          <Placemark id="pin_end_${escapeXml(section.id)}_${letter}">
            <name>Sec ${escapeXml(section.id)} End (${letter})</name>
            <styleUrl>#style_pin_end</styleUrl>
            <description><![CDATA[TRM ${escapeXml(section.endTrm ?? '—')}<br/>DFO ${escapeXml(section.endDfo ?? '—')}]]></description>
            <Point>
              <coordinates>${data.end[1].toFixed(7)},${data.end[0].toFixed(7)},0</coordinates>
            </Point>
          </Placemark>
        `;
      }
    });

    if (sectionPlacemarks) {
      // Dynamic style for condition color if enabled
      const condStyleXml = colorMode === 'condition' ? `
        <Style id="style_cond_${escapeXml(section.id)}">
          <LineStyle>
            <color>${colorR}</color>
            <width>4</width>
          </LineStyle>
        </Style>
      ` : '';

      foldersXml += `
        <Folder>
          <name>Section ${escapeXml(section.id)} - ${escapeXml(section.highway || 'Highway')}</name>
          ${condStyleXml}
          ${sectionPlacemarks}
        </Folder>
      `;
    }
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(projectName)}</name>
    <description>TxDOT PMIS Sections Export generated by PMIS Chart Studio</description>

    <!-- Global Styles -->
    <Style id="style_roadbed_r">
      <LineStyle>
        <color>ff1673f9</color> <!-- Orange (#f97316) -->
        <width>4</width>
      </LineStyle>
    </Style>
    <Style id="style_roadbed_l">
      <LineStyle>
        <color>ffe9a50e</color> <!-- Sky Blue (#0ea5e9) -->
        <width>4</width>
      </LineStyle>
    </Style>
    <Style id="style_pin_start">
      <IconStyle>
        <color>ff00ff00</color>
        <scale>1.0</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Style id="style_pin_end">
      <IconStyle>
        <color>ff0000ff</color>
        <scale>1.0</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href>
        </Icon>
      </IconStyle>
    </Style>

    <Folder>
      <name>All Sections (${(sections || []).length})</name>
      ${foldersXml}
    </Folder>
  </Document>
</kml>`;
}

// ── GeoJSON Generator ───────────────────────────────────────────────────────

/**
 * Generate standard RFC 7946 GeoJSON FeatureCollection
 */
export function buildGeoJson(sections, options = {}) {
  const { roadbeds = 'both' } = options;

  const features = [];

  (sections || []).forEach(section => {
    const c = section.coordinates || {};
    const slab = section.slabTh ?? section.oldSlabTh;
    const slabNum = slab !== null && slab !== undefined && String(slab).trim() !== '' ? parseFloat(slab) : null;

    const beds = [];
    if ((roadbeds === 'both' || roadbeds === 'R') && c.R?.available) {
      beds.push({ letter: 'R', data: c.R, label: 'Roadbed R (Inventory)' });
    }
    if ((roadbeds === 'both' || roadbeds === 'L') && c.L?.available) {
      beds.push({ letter: 'L', data: c.L, label: 'Roadbed L (Opposing)' });
    }

    beds.forEach(({ letter, data, label }) => {
      let latLngs = [];
      if (data.path && data.path.length > 1) {
        latLngs = data.path.map(p => [p[0], p[1]]);
      } else if (data.begin && data.end) {
        latLngs = [data.begin, data.end];
      }
      if (latLngs.length < 2) return;

      // In GeoJSON, coordinates are [longitude, latitude]
      const coordinates = latLngs.map(pt => [
        parseFloat(pt[1].toFixed(7)),
        parseFloat(pt[0].toFixed(7)),
      ]);

      const cond = section.latestCondition ?? section.conditionScore ?? null;
      const dist = section.latestDistress ?? section.distressScore ?? null;
      const ride = section.latestRide ?? section.rideScore ?? null;

      features.push({
        type: 'Feature',
        id: `${section.id}_${letter}`,
        properties: {
          sectionId: section.id,
          roadbed: letter,
          roadbedLabel: label,
          highway: section.highway || null,
          county: section.countyName || null,
          csj: section.csj || null,
          beginTrm: section.beginTrm ?? null,
          endTrm: section.endTrm ?? null,
          beginDfo: section.beginDfo ?? null,
          endDfo: section.endDfo ?? null,
          slabThicknessInches: !isNaN(slabNum) ? slabNum : null,
          lengthMiles: data.lengthMiles ?? null,
          routeId: data.routeId || null,
          conditionScore: cond,
          distressScore: dist,
          rideScore: ride,
          conditionRating: getConditionRating(cond),
        },
        geometry: {
          type: 'LineString',
          coordinates,
        },
      });
    });
  });

  return {
    type: 'FeatureCollection',
    name: options.projectName || 'PMIS_Roadways',
    features,
  };
}

// ── ZIP Bundle Generator ────────────────────────────────────────────────────

/**
 * Creates a .zip bundle containing:
 *  - Individual .kml file for each section inside `kml_sections/`
 *  - Master combined .kml at root
 *  - GeoJSON .geojson at root
 *  - README.txt
 */
export async function createGisZipBundle(sections, options = {}, onProgress = null) {
  const {
    projectName = 'PMIS_Project',
    colorMode = 'roadbed',
    roadbeds = 'both',
    includePins = true,
  } = options;

  const zip = new JSZip();
  const validSections = (sections || []).filter(s => {
    const c = s.coordinates || {};
    return (c.R?.available && (c.R.path?.length > 1 || c.R.begin)) ||
           (c.L?.available && (c.L.path?.length > 1 || c.L.begin));
  });

  if (validSections.length === 0) {
    throw new Error('None of the selected sections have available GPS coordinates to export.');
  }

  const kmlFolder = zip.folder('individual_sections_kml');

  // 1. Add individual KML for each section
  validSections.forEach((section, idx) => {
    if (onProgress) {
      onProgress({ current: idx + 1, total: validSections.length, stage: 'Building section KMLs' });
    }
    const kml = buildSectionKml(section, { colorMode, roadbeds, includePins });
    const cleanId = sanitizeFilename(section.id);
    const cleanHwy = sanitizeFilename(section.highway || 'road');
    kmlFolder.file(`Section_${cleanId}_${cleanHwy}.kml`, kml);
  });

  // 2. Add combined KML
  if (onProgress) {
    onProgress({ current: validSections.length, total: validSections.length, stage: 'Generating combined KML...' });
  }
  const combinedKml = buildCombinedKml(validSections, { projectName, colorMode, roadbeds, includePins });
  zip.file(`${sanitizeFilename(projectName)}_Combined.kml`, combinedKml);

  // 3. Add GeoJSON
  if (onProgress) {
    onProgress({ current: validSections.length, total: validSections.length, stage: 'Generating GeoJSON...' });
  }
  const geojson = buildGeoJson(validSections, { projectName, roadbeds });
  zip.file(`${sanitizeFilename(projectName)}_Roadways.geojson`, JSON.stringify(geojson, null, 2));

  // 4. Add README.txt
  const dateStr = new Date().toLocaleString();
  const readmeContent = `TxDOT PMIS GIS Export Bundle
Generated: ${dateStr}
Project: ${projectName}
Total Exported Sections: ${validSections.length}
Roadbeds Included: ${roadbeds === 'both' ? 'Roadbed R & L' : `Roadbed ${roadbeds}`}

Contents of this archive:
1. individual_sections_kml/ : Separate Google Earth .kml files for each individual section.
   - Open any file directly in Google Earth desktop or web (earth.google.com).
2. ${sanitizeFilename(projectName)}_Combined.kml : Master Google Earth file with all sections organized in folders.
   - Drag and drop into Google Earth to see the entire project network at once.
3. ${sanitizeFilename(projectName)}_Roadways.geojson : RFC 7946 GeoJSON format.
   - Compatible with ArcGIS Pro, QGIS, Mapbox, Leaflet, and Python geopandas.

Generated with PMIS Chart Studio.
`.trim();
  zip.file('README.txt', readmeContent);

  // Generate blob
  if (onProgress) {
    onProgress({ current: validSections.length, total: validSections.length, stage: 'Compressing ZIP archive...' });
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const filename = `${sanitizeFilename(projectName)}_GIS_Bundle.zip`;
  triggerDownload(zipBlob, filename);
  return filename;
}

// ── Single File Download Triggers ───────────────────────────────────────────

export function downloadSingleSectionKml(section, options = {}) {
  const kml = buildSectionKml(section, options);
  const cleanId = sanitizeFilename(section.id);
  const cleanHwy = sanitizeFilename(section.highway || 'road');
  const filename = `Section_${cleanId}_${cleanHwy}.kml`;
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
  triggerDownload(blob, filename);
}

export function downloadCombinedKml(sections, filename = 'PMIS_Sections.kml', options = {}) {
  const kml = buildCombinedKml(sections, options);
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
  triggerDownload(blob, filename.endsWith('.kml') ? filename : `${filename}.kml`);
}

export function downloadGeoJson(sections, filename = 'PMIS_Sections.geojson', options = {}) {
  const geojson = buildGeoJson(sections, options);
  const str = JSON.stringify(geojson, null, 2);
  const blob = new Blob([str], { type: 'application/geo+json;charset=utf-8' });
  triggerDownload(blob, filename.endsWith('.geojson') ? filename : `${filename}.geojson`);
}
