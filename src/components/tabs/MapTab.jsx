/**
 * MapTab.jsx
 * Interactive GIS Mapping workspace for PMIS sections.
 * Features:
 * - High-performance Leaflet integration with multi-basemap support (Satellite, Dark Matter, Streets, Topo)
 * - Roadbed R (Inventory) and Roadbed L (Opposing) physical polyline overlays from TxDOT LRS
 * - Metric-based color coding (Condition Score, Distress Score, Ride Score, Roadbed R/L, Slab Thickness)
 * - Collapsible section explorer drawer with instant fly-to zooming
 * - Interactive rich popups with score ratings, DFO distance, and direct jump to Condition charts
 * - Floating collapsible legend and project overview statistics
 * - Quick batch generator trigger for unmapped sections
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import {
  getConditionCategory,
  getDistressCategory,
  getRideCategory,
  CATEGORY_COLORS,
  CATEGORY_BG_COLORS,
} from '../../utils/distributionBuilder';
import { buildEvalData, parseHighwayComponents } from '../../utils/chartBuilder';
import { formatGpsDisplay, fetchCoordinatesForSection } from '../../utils/txdotGisApi';
import CoordinateModal from '../modals/CoordinateModal';
import BatchGpsModal from '../modals/BatchGpsModal';
import GisExportModal from '../modals/GisExportModal';
import { downloadSingleSectionKml } from '../../utils/gisExporter';

const CARTO_KEY = import.meta.env.VITE_CARTO_API_KEY || 'cb1_3x0o_1_0e98f5ff4c4adb42019dcfeb';
const cartoKeyParam = CARTO_KEY ? `?key=${CARTO_KEY}` : '';

// Basemap Tile Providers
const BASEMAPS = {
  dark: {
    name: 'Dark Matter (Sleek)',
    url: `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png${cartoKeyParam}`,
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  satellite: {
    name: 'Satellite Hybrid',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
    labelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
  voyager: {
    name: 'Voyager (Detailed)',
    url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${cartoKeyParam}`,
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 20,
    subdomains: 'abcd',
  },
  streets: {
    name: 'Streets (OpenStreetMap)',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  topo: {
    name: 'Topographic (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
    maxZoom: 19,
  },
};

// Roadbed Colors for Roadbed color mode
const ROADBED_COLORS = {
  R: '#f97316', // Orange / Amber
  L: '#0ea5e9', // Sky Blue / Cyan
  K: '#10b981', // Emerald / Undivided
};

export default function MapTab({
  project,
  sections = [],
  selectedSectionId,
  onSelectSection,
  onUpdateSection,
  onBatchUpdateSections,
  pmisMap,
  addToast,
}) {
  // ── States ─────────────────────────────────────────────────────────────────
  const [selectedBasemap, setSelectedBasemap] = useState('dark');
  const [colorMetric, setColorMetric] = useState('condition'); // 'condition' | 'distress' | 'ride' | 'roadbed' | 'slab'
  const [roadbedFilter, setRoadbedFilter] = useState('both');   // 'both' | 'R' | 'L'
  const [endpointMarkers, setEndpointMarkers] = useState('none'); // 'none' | 'selected' | 'faint'
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');      // 'all' | 'mapped' | 'unmapped'
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLegendOpen, setIsLegendOpen] = useState(true);

  // Modals
  const [inspectSection, setInspectSection] = useState(null);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchSectionsQueue, setBatchSectionsQueue] = useState([]);
  const [isGisExportOpen, setIsGisExportOpen] = useState(false);

  // DOM Refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const labelsLayerRef = useRef(null);
  const layersGroupRef = useRef(null);
  const sectionLayersMapRef = useRef(new Map()); // sectionId -> array of layers

  // ── Compute Section Scores ────────────────────────────────────────────────
  const sectionScores = useMemo(() => {
    const map = new Map();
    if (!sections?.length) return map;

    sections.forEach(s => {
      // Evaluate latest scores for R, L, and aggregate
      const evalR = pmisMap ? buildEvalData(pmisMap, s, 'R') : null;
      const evalL = pmisMap ? buildEvalData(pmisMap, s, 'L') : null;
      const evalGen = pmisMap ? buildEvalData(pmisMap, s, '') : null;

      const extractLatest = (evalObj) => {
        if (!evalObj || !evalObj.years?.length) return null;
        const lastIdx = evalObj.years.length - 1;
        return {
          year: evalObj.years[lastIdx],
          condition: evalObj.conditionScore[lastIdx],
          distress: evalObj.distressScore[lastIdx],
          ride: evalObj.rideScore[lastIdx],
        };
      };

      const scoreR = extractLatest(evalR);
      const scoreL = extractLatest(evalL);
      const scoreGen = extractLatest(evalGen);

      map.set(s.id, {
        R: scoreR || scoreGen,
        L: scoreL || scoreGen,
        overall: scoreGen || scoreR || scoreL || null,
      });
    });

    return map;
  }, [sections, pmisMap]);

  // ── Mapped vs Unmapped Section Counts ──────────────────────────────────────
  const { mappedSections, unmappedSections } = useMemo(() => {
    const mapped = [];
    const unmapped = [];
    sections.forEach(s => {
      const c = s.coordinates;
      const hasR = c?.R?.available && (c.R.path?.length > 0 || c.R.begin);
      const hasL = c?.L?.available && (c.L.path?.length > 0 || c.L.begin);
      if (hasR || hasL) {
        mapped.push(s);
      } else {
        unmapped.push(s);
      }
    });
    return { mappedSections: mapped, unmappedSections: unmapped };
  }, [sections]);

  // Check if any section has valid slab thickness data
  const hasSlabThickness = useMemo(() => {
    return (sections || []).some(s => {
      const val = s.slabTh ?? s.oldSlabTh;
      return val !== null && val !== undefined && String(val).trim() !== '' && !isNaN(parseFloat(val));
    });
  }, [sections]);

  // Fallback colorMetric if slab is selected but not available
  useEffect(() => {
    if (colorMetric === 'slab' && !hasSlabThickness) {
      setColorMetric('condition');
    }
  }, [colorMetric, hasSlabThickness]);

  // ── Filtered Sections for Sidebar ──────────────────────────────────────────
  const sidebarSections = useMemo(() => {
    return sections.filter(s => {
      // Status filter
      const isMapped = s.coordinates?.R?.available || s.coordinates?.L?.available;
      if (statusFilter === 'mapped' && !isMapped) return false;
      if (statusFilter === 'unmapped' && isMapped) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesId = String(s.id).toLowerCase().includes(q);
        const matchesHwy = String(s.highway || '').toLowerCase().includes(q);
        const matchesCsj = String(s.csj || '').toLowerCase().includes(q);
        const matchesCounty = String(s.countyName || '').toLowerCase().includes(q);
        if (!matchesId && !matchesHwy && !matchesCsj && !matchesCounty) return false;
      }

      return true;
    });
  }, [sections, statusFilter, searchQuery]);

  // ── Initialize Leaflet Map ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return; // already initialized

    // Default center on Texas
    const map = L.map(mapContainerRef.current, {
      center: [31.5, -99.5],
      zoom: 6,
      zoomControl: false,
    });

    // Custom top-right zoom control
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Initial Tile Layer
    const baseConfig = BASEMAPS[selectedBasemap] || BASEMAPS.dark;
    const tileLayer = L.tileLayer(baseConfig.url, {
      attribution: baseConfig.attribution,
      maxZoom: baseConfig.maxZoom || 19,
      subdomains: baseConfig.subdomains || 'abc',
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    // Feature group for section polylines and markers
    const group = L.featureGroup().addTo(map);
    layersGroupRef.current = group;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // ── Update Basemap on Selection Change ─────────────────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    if (labelsLayerRef.current) {
      map.removeLayer(labelsLayerRef.current);
      labelsLayerRef.current = null;
    }

    const baseConfig = BASEMAPS[selectedBasemap] || BASEMAPS.dark;
    tileLayerRef.current = L.tileLayer(baseConfig.url, {
      attribution: baseConfig.attribution,
      maxZoom: baseConfig.maxZoom || 19,
      subdomains: baseConfig.subdomains || 'abc',
    }).addTo(map);

    // Add labels layer for satellite hybrid if specified
    if (baseConfig.labelsUrl) {
      labelsLayerRef.current = L.tileLayer(baseConfig.labelsUrl, {
        maxZoom: 19,
      }).addTo(map);
    }
  }, [selectedBasemap]);

  // ── Color Resolving Helper ────────────────────────────────────────────────
  const getLineColor = (section, roadbed) => {
    if (colorMetric === 'roadbed') {
      return roadbed === 'R' ? ROADBED_COLORS.R : (roadbed === 'L' ? ROADBED_COLORS.L : ROADBED_COLORS.K);
    }

    const scores = sectionScores.get(section.id);
    const scoreObj = scores ? (roadbed === 'R' ? scores.R : scores.L) || scores.overall : null;

    if (colorMetric === 'condition') {
      const score = scoreObj?.condition;
      const cat = getConditionCategory(score);
      return cat ? (CATEGORY_COLORS[cat] || '#3b82f6') : '#64748b';
    }

    if (colorMetric === 'distress') {
      const score = scoreObj?.distress;
      const cat = getDistressCategory(score);
      return cat ? (CATEGORY_COLORS[cat] || '#3b82f6') : '#64748b';
    }

    if (colorMetric === 'ride') {
      const score = scoreObj?.ride;
      const cat = getRideCategory(score);
      return cat ? (CATEGORY_COLORS[cat] || '#3b82f6') : '#64748b';
    }

    if (colorMetric === 'slab') {
      const raw = section.slabTh ?? section.oldSlabTh;
      if (raw === undefined || raw === null || String(raw).trim() === '') return '#64748b';
      const th = parseFloat(raw);
      if (isNaN(th)) return '#64748b';
      if (th >= 12) return '#8b5cf6';
      if (th >= 10) return '#3b82f6';
      if (th >= 8)  return '#10b981';
      return '#f59e0b';
    }

    return '#3b82f6';
  };

  // ── Render Section Polylines on Map ───────────────────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    const group = layersGroupRef.current;
    if (!map || !group) return;

    // Clear previous layers
    group.clearLayers();
    sectionLayersMapRef.current.clear();

    const allLatLngs = [];

    mappedSections.forEach(section => {
      const c = section.coordinates;
      const secLayers = [];

      const bedsToRender = [];
      if ((roadbedFilter === 'both' || roadbedFilter === 'R') && c.R?.available) {
        bedsToRender.push({ letter: 'R', data: c.R, label: 'Roadbed R (Inventory)' });
      }
      if ((roadbedFilter === 'both' || roadbedFilter === 'L') && c.L?.available) {
        bedsToRender.push({ letter: 'L', data: c.L, label: 'Roadbed L (Opposing)' });
      }

      bedsToRender.forEach(({ letter, data, label }) => {
        let latLngs = [];
        if (data.path && data.path.length > 1) {
          latLngs = data.path.map(p => [p[0], p[1]]);
        } else if (data.begin && data.end) {
          latLngs = [data.begin, data.end];
        }

        if (latLngs.length < 2) return;

        allLatLngs.push(...latLngs);

        const color = getLineColor(section, letter);
        const isSelected = selectedSectionId === section.id;

        // Draw Polyline
        const polyline = L.polyline(latLngs, {
          color: color,
          weight: isSelected ? 8 : 5,
          opacity: isSelected ? 1 : 0.85,
          dashArray: data.isUndivided ? '8, 8' : null,
          lineCap: 'round',
          lineJoin: 'round',
        });

        // Hover effect
        polyline.on('mouseover', () => {
          polyline.setStyle({ weight: 9, opacity: 1 });
        });
        polyline.on('mouseout', () => {
          polyline.setStyle({
            weight: selectedSectionId === section.id ? 8 : 5,
            opacity: selectedSectionId === section.id ? 1 : 0.85,
          });
        });

        // Click handler -> Select Section
        polyline.on('click', () => {
          if (onSelectSection) onSelectSection(section.id);
        });

        // Popup Content
        const scores = sectionScores.get(section.id);
        const sObj = (letter === 'R' ? scores?.R : scores?.L) || scores?.overall;

        const condScore = sObj?.condition ? sObj.condition.toFixed(1) : '—';
        const condCat = sObj?.condition ? getConditionCategory(sObj.condition) : null;
        const distScore = sObj?.distress ? sObj.distress.toFixed(1) : '—';
        const distCat = sObj?.distress ? getDistressCategory(sObj.distress) : null;
        const rideScore = sObj?.ride ? sObj.ride.toFixed(2) : '—';
        const rideCat = sObj?.ride ? getRideCategory(sObj.ride) : null;

        const popupHtml = `
          <div style="font-family: inherit; font-size: 13px; color: #1e293b; min-width: 240px; padding: 2px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
              <div>
                <strong style="font-size: 15px; color: #0f172a;">${section.id}</strong>
                <span style="font-size: 12px; color: #64748b; margin-left: 6px;">${section.highway}</span>
              </div>
              <span style="font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: ${color}20; color: ${color};">
                Roadbed ${letter}
              </span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 11px; margin-bottom: 8px; color: #475569;">
              <div><strong>CSJ:</strong> ${section.csj || '—'}</div>
              <div><strong>County:</strong> ${section.countyName || '—'}</div>
              <div><strong>Begin Ref:</strong> ${typeof section.beginRef === 'number' ? section.beginRef.toFixed(3) : section.beginRef}</div>
              <div><strong>End Ref:</strong> ${typeof section.endRef === 'number' ? section.endRef.toFixed(3) : section.endRef}</div>
              <div><strong>DFO Range:</strong> ${data.beginDfo ?? '—'} – ${data.endDfo ?? '—'}</div>
              <div><strong>Length:</strong> ${data.lengthMiles ?? '—'} mi</div>
            </div>

            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; margin-bottom: 10px;">
              <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 4px;">
                Latest PMIS Scores ${sObj?.year ? `(${sObj.year})` : ''}
              </div>
              <div style="display: flex; justify-content: space-between; gap: 4px; text-align: center;">
                <div style="flex: 1; padding: 4px; background: #fff; border-radius: 4px; border: 1px solid #e2e8f0;">
                  <div style="font-size: 10px; color: #64748b;">Condition</div>
                  <div style="font-size: 13px; font-weight: 700; color: ${condCat ? CATEGORY_COLORS[condCat] : '#0f172a'};">${condScore}</div>
                </div>
                <div style="flex: 1; padding: 4px; background: #fff; border-radius: 4px; border: 1px solid #e2e8f0;">
                  <div style="font-size: 10px; color: #64748b;">Distress</div>
                  <div style="font-size: 13px; font-weight: 700; color: ${distCat ? CATEGORY_COLORS[distCat] : '#0f172a'};">${distScore}</div>
                </div>
                <div style="flex: 1; padding: 4px; background: #fff; border-radius: 4px; border: 1px solid #e2e8f0;">
                  <div style="font-size: 10px; color: #64748b;">Ride</div>
                  <div style="font-size: 13px; font-weight: 700; color: ${rideCat ? CATEGORY_COLORS[rideCat] : '#0f172a'};">${rideScore}</div>
                </div>
              </div>
            </div>

            <div style="display: flex; gap: 6px;">
              <button
                id="btn-popup-charts-${section.id}"
                style="flex: 1; padding: 6px 10px; background: #2563eb; color: #fff; border: none; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer;"
              >
                📈 View Charts
              </button>
              <button
                id="btn-popup-coords-${section.id}"
                style="padding: 6px 10px; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer;"
                title="View coordinates & details"
              >
                📍 GPS
              </button>
              <button
                id="btn-popup-kml-${section.id}"
                style="padding: 6px 10px; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer;"
                title="Download Google Earth KML for this section"
              >
                📥 KML
              </button>
            </div>
          </div>
        `;

        polyline.bindPopup(popupHtml, { maxWidth: 300 });

        polyline.on('popupopen', () => {
          setTimeout(() => {
            const btnCharts = document.getElementById(`btn-popup-charts-${section.id}`);
            if (btnCharts) {
              btnCharts.onclick = () => {
                if (onSelectSection) onSelectSection(section.id);
              };
            }
            const btnCoords = document.getElementById(`btn-popup-coords-${section.id}`);
            if (btnCoords) {
              btnCoords.onclick = () => {
                setInspectSection(section);
              };
            }
            const btnKml = document.getElementById(`btn-popup-kml-${section.id}`);
            if (btnKml) {
              btnKml.onclick = () => {
                downloadSingleSectionKml(section);
                if (addToast) addToast('success', 'KML Downloaded', `Saved Google Earth KML for Section ${section.id}`);
              };
            }
          }, 50);
        });

        // Start / End Endpoint Markers (neutral, subtle halos — never red or green to avoid confusion with condition scores)
        const shouldShowPoints =
          endpointMarkers === 'faint' ||
          (endpointMarkers === 'selected' && isSelected);

        if (shouldShowPoints) {
          const startIcon = L.divIcon({
            className: 'custom-map-pin pin-neutral-start',
            html: `<div style="width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.45); border: 2px solid rgba(255,255,255,0.9); box-shadow: 0 1px 3px rgba(0,0,0,0.5);" title="Start: ${section.id} (${letter})"></div>`,
            iconSize: [8, 8],
            iconAnchor: [4, 4],
          });
          const endIcon = L.divIcon({
            className: 'custom-map-pin pin-neutral-end',
            html: `<div style="width: 8px; height: 8px; border-radius: 50%; background: rgba(15,23,42,0.6); border: 2px solid rgba(255,255,255,0.9); box-shadow: 0 1px 3px rgba(0,0,0,0.5);" title="End: ${section.id} (${letter})"></div>`,
            iconSize: [8, 8],
            iconAnchor: [4, 4],
          });

          const startMarker = L.marker(latLngs[0], { icon: startIcon, interactive: false });
          const endMarker = L.marker(latLngs[latLngs.length - 1], { icon: endIcon, interactive: false });

          group.addLayer(startMarker);
          group.addLayer(endMarker);
          secLayers.push(startMarker, endMarker);
        }

        group.addLayer(polyline);
        secLayers.push(polyline);
      });

      sectionLayersMapRef.current.set(section.id, secLayers);
    });

    // Auto-fit bounds if we have points and not currently focused
    if (allLatLngs.length > 0 && !selectedSectionId) {
      const bounds = L.latLngBounds(allLatLngs);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [mappedSections, colorMetric, roadbedFilter, selectedSectionId, sectionScores, endpointMarkers]);

  // ── Fly to Selected Section on Selection Change ───────────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedSectionId) return;

    const targetSection = sections.find(s => s.id === selectedSectionId);
    if (!targetSection?.coordinates) return;

    const c = targetSection.coordinates;
    const pts = [];
    if (c.R?.path) pts.push(...c.R.path);
    else if (c.R?.begin) pts.push(c.R.begin, c.R.end);

    if (c.L?.path) pts.push(...c.L.path);
    else if (c.L?.begin) pts.push(c.L.begin, c.L.end);

    if (pts.length > 0) {
      const bounds = L.latLngBounds(pts.map(p => [p[0], p[1]]));
      map.flyToBounds(bounds, { padding: [80, 80], maxZoom: 15, duration: 1.0 });

      // Open popup on the section polyline if possible
      const secLayers = sectionLayersMapRef.current.get(selectedSectionId);
      const poly = secLayers?.find(l => l instanceof L.Polyline);
      if (poly) {
        setTimeout(() => poly.openPopup(), 1100);
      }
    }
  }, [selectedSectionId, sections]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleFitAll = () => {
    const map = mapInstanceRef.current;
    const group = layersGroupRef.current;
    if (!map || !group) return;

    const layers = group.getLayers();
    if (layers.length === 0) {
      if (addToast) addToast('info', 'No Mapped Sections', 'Generate GPS coordinates first to view sections on the map.');
      return;
    }

    const bounds = group.getBounds();
    if (bounds.isValid()) {
      map.flyToBounds(bounds, { padding: [50, 50], duration: 1.0 });
    }
  };

  const handleOpenBatch = () => {
    // Generate for unmapped sections or all
    const queue = unmappedSections.length > 0 ? unmappedSections : sections;
    if (queue.length === 0) {
      if (addToast) addToast('info', 'All Sections Mapped', 'All sections already have GPS coordinates.');
      return;
    }
    setBatchSectionsQueue(queue);
    setIsBatchModalOpen(true);
  };

  const handleBatchComplete = (updatedList) => {
    if (onBatchUpdateSections) {
      onBatchUpdateSections(updatedList);
    } else if (onUpdateSection) {
      updatedList.forEach(s => onUpdateSection(s));
    }
  };

  const handleFlyToSection = (section) => {
    if (onSelectSection) onSelectSection(section.id);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 120px)',
      minHeight: 550,
      background: 'var(--bg-app)',
      position: 'relative',
      borderRadius: '8px',
      overflow: 'hidden',
      border: '1px solid var(--border-default)',
    }}>
      {/* ── Top Map Control Bar ────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 14px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-default)',
        gap: 10,
        zIndex: 10,
      }}>
        {/* Left Toolbar Controls */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          {/* Toggle Sidebar Button */}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setIsSidebarOpen(prev => !prev)}
            title={isSidebarOpen ? 'Hide Section Explorer' : 'Show Section Explorer'}
            style={{ padding: '5px 9px', fontSize: 13 }}
          >
            <span>{isSidebarOpen ? '◀' : '▶'}</span>
            <span>Sections ({mappedSections.length}/{sections.length})</span>
          </button>

          <div style={{ width: 1, height: 18, background: 'var(--border-default)' }} />

          {/* Color Metric Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Color By:</span>
            <select
              className="select-input"
              value={colorMetric}
              onChange={e => setColorMetric(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4 }}
            >
              <option value="condition">Condition Score</option>
              <option value="distress">Distress Score</option>
              <option value="ride">Ride Score</option>
              <option value="roadbed">Roadbed (R vs L)</option>
              <option
                value="slab"
                disabled={!hasSlabThickness}
                style={!hasSlabThickness ? { opacity: 0.5, color: '#888' } : {}}
              >
                Slab Thickness {!hasSlabThickness ? '(Not Available)' : ''}
              </option>
            </select>
          </div>

          {/* Roadbed Filter Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Roadbeds:</span>
            <div style={{ display: 'inline-flex', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border-default)' }}>
              <button
                type="button"
                className={`btn btn--sm ${roadbedFilter === 'both' ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setRoadbedFilter('both')}
                style={{ padding: '3px 8px', fontSize: 12, borderRadius: 0 }}
              >
                Both (R & L)
              </button>
              <button
                type="button"
                className={`btn btn--sm ${roadbedFilter === 'R' ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setRoadbedFilter('R')}
                style={{ padding: '3px 8px', fontSize: 12, borderRadius: 0 }}
              >
                R Only
              </button>
              <button
                type="button"
                className={`btn btn--sm ${roadbedFilter === 'L' ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => setRoadbedFilter('L')}
                style={{ padding: '3px 8px', fontSize: 12, borderRadius: 0 }}
              >
                L Only
              </button>
            </div>
          </div>

          {/* Basemap Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Basemap:</span>
            <select
              className="select-input"
              value={selectedBasemap}
              onChange={e => setSelectedBasemap(e.target.value)}
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4 }}
            >
              <option value="dark">Dark Matter (CARTO)</option>
              <option value="voyager">Voyager (CARTO)</option>
              <option value="satellite">Satellite Hybrid</option>
              <option value="streets">Streets (OSM)</option>
              <option value="topo">Topographic (Esri)</option>
            </select>
          </div>

          {/* Endpoints Display Option */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Points:</span>
            <select
              className="select-input"
              value={endpointMarkers}
              onChange={e => setEndpointMarkers(e.target.value)}
              title="Configure endpoint marker visibility"
              style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4 }}
            >
              <option value="none">No Points (Clean)</option>
              <option value="selected">Selected Only</option>
              <option value="faint">Faint Neutral Dots</option>
            </select>
          </div>
        </div>

        {/* Right Toolbar Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Fit Bounds */}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={handleFitAll}
            title="Zoom to fit all mapped sections in view"
            style={{ gap: 5, fontSize: 12, padding: '5px 10px' }}
          >
            <span>🎯</span>
            <span>Fit All</span>
          </button>

          {/* GIS Export Button */}
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setIsGisExportOpen(true)}
            title="Export sections to Google Earth (.kml) or GeoJSON"
            style={{
              gap: 5,
              fontSize: 12,
              padding: '5px 11px',
              background: 'rgba(59, 130, 246, 0.08)',
              borderColor: 'rgba(59, 130, 246, 0.4)',
              color: 'var(--text-primary)',
              fontWeight: 600,
            }}
          >
            <span>🌍</span>
            <span>GIS Export</span>
          </button>

          {/* Generate Missing GPS */}
          {unmappedSections.length > 0 && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleOpenBatch}
              title="Generate TxDOT GPS coordinates for sections missing location data"
              style={{ gap: 5, fontSize: 12, padding: '5px 12px' }}
            >
              <span>🌐</span>
              <span>Generate Missing GPS ({unmappedSections.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Main Workspace: Sidebar + Map ──────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Collapsible Left Section Explorer Drawer */}
        {isSidebarOpen && (
          <aside style={{
            width: 320,
            minWidth: 280,
            maxWidth: 360,
            background: 'var(--bg-surface)',
            borderRight: '1px solid var(--border-default)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 5,
          }}>
            {/* Search & Status Filters */}
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
              <input
                type="text"
                className="search-input"
                placeholder="Search ID, Highway, CSJ..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ width: '100%', fontSize: 12, marginBottom: 8 }}
              />

              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className={`btn btn--xs ${statusFilter === 'all' ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setStatusFilter('all')}
                  style={{ flex: 1, padding: '3px 0', fontSize: 11 }}
                >
                  All ({sections.length})
                </button>
                <button
                  type="button"
                  className={`btn btn--xs ${statusFilter === 'mapped' ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setStatusFilter('mapped')}
                  style={{ flex: 1, padding: '3px 0', fontSize: 11 }}
                >
                  Mapped ({mappedSections.length})
                </button>
                <button
                  type="button"
                  className={`btn btn--xs ${statusFilter === 'unmapped' ? 'btn--primary' : 'btn--ghost'}`}
                  onClick={() => setStatusFilter('unmapped')}
                  style={{ flex: 1, padding: '3px 0', fontSize: 11 }}
                >
                  No GPS ({unmappedSections.length})
                </button>
              </div>
            </div>

            {/* Sections List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              {sidebarSections.length === 0 ? (
                <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                  No sections match your filter.
                </div>
              ) : (
                sidebarSections.map(s => {
                  const isSelected = selectedSectionId === s.id;
                  const c = s.coordinates;
                  const hasGps = c?.status === 'success' && (c.R?.available || c.L?.available);
                  const scores = sectionScores.get(s.id);
                  const latestScore = scores?.overall || scores?.R || scores?.L;

                  let scoreBadge = null;
                  if (colorMetric === 'condition' && latestScore?.condition != null) {
                    const cat = getConditionCategory(latestScore.condition);
                    scoreBadge = { val: latestScore.condition.toFixed(0), cat };
                  } else if (colorMetric === 'distress' && latestScore?.distress != null) {
                    const cat = getDistressCategory(latestScore.distress);
                    scoreBadge = { val: latestScore.distress.toFixed(0), cat };
                  } else if (colorMetric === 'ride' && latestScore?.ride != null) {
                    const cat = getRideCategory(latestScore.ride);
                    scoreBadge = { val: latestScore.ride.toFixed(1), cat };
                  }

                  return (
                    <div
                      key={s.id}
                      onClick={() => handleFlyToSection(s)}
                      style={{
                        padding: '10px 12px',
                        marginBottom: 6,
                        borderRadius: 6,
                        background: isSelected ? 'var(--bg-elevated)' : 'var(--bg-card)',
                        border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: hasGps ? '#22c55e' : '#eab308',
                            display: 'inline-block',
                          }} />
                          <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{s.id}</strong>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.highway}</span>
                        </div>

                        {scoreBadge && (
                          <span style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: CATEGORY_BG_COLORS[scoreBadge.cat] || 'rgba(255,255,255,0.1)',
                            color: CATEGORY_COLORS[scoreBadge.cat] || 'var(--text-primary)',
                          }}>
                            {scoreBadge.val}
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>RM: {typeof s.beginRef === 'number' ? s.beginRef.toFixed(3) : s.beginRef} – {typeof s.endRef === 'number' ? s.endRef.toFixed(3) : s.endRef}</span>
                        {s.csj && <span>CSJ: {s.csj}</span>}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, fontSize: 11 }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {c?.R?.available && (
                            <span style={{ fontSize: 10, padding: '1px 4px', borderRadius: 3, background: 'rgba(249, 115, 22, 0.15)', color: '#f97316' }}>
                              R ({c.R.lengthMiles ?? '—'} mi)
                            </span>
                          )}
                          {c?.L?.available && (
                            <span style={{ fontSize: 10, padding: '1px 4px', borderRadius: 3, background: 'rgba(14, 165, 233, 0.15)', color: '#0ea5e9' }}>
                              L ({c.L.lengthMiles ?? '—'} mi)
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 4 }}>
                          {hasGps && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--xs"
                              onClick={e => {
                                e.stopPropagation();
                                downloadSingleSectionKml(s);
                                if (addToast) addToast('success', 'KML Downloaded', `Saved Google Earth KML for Section ${s.id}`);
                              }}
                              title="Download Google Earth KML"
                              style={{ padding: '2px 5px', fontSize: 11 }}
                            >
                              📥 KML
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn--ghost btn--xs"
                            onClick={e => {
                              e.stopPropagation();
                              setInspectSection(s);
                            }}
                            title="View / Fetch GPS details"
                            style={{ padding: '2px 6px', fontSize: 11 }}
                          >
                            📍 GPS
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* ── Map Container ─────────────────────────────────────────────────── */}
        <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%', background: '#0f172a' }} />

          {/* ── Floating Collapsible Legend ─────────────────────────────────── */}
          <div style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            background: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 8,
            padding: isLegendOpen ? '10px 14px' : '6px 10px',
            color: '#f8fafc',
            fontSize: 12,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            zIndex: 1000,
            minWidth: isLegendOpen ? 180 : 'auto',
          }}>
            <div
              onClick={() => setIsLegendOpen(prev => !prev)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 12,
                color: '#94a3b8',
                marginBottom: isLegendOpen ? 8 : 0,
              }}
            >
              <span>{isLegendOpen ? `Legend • ${colorMetric.toUpperCase()}` : '🗺️ Legend'}</span>
              <span style={{ fontSize: 10, marginLeft: 8 }}>{isLegendOpen ? '▼' : '▲'}</span>
            </div>

            {isLegendOpen && (
              <div>
                {/* Score rating scale */}
                {(colorMetric === 'condition' || colorMetric === 'distress' || colorMetric === 'ride') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {[
                      { label: 'Very Good', score: colorMetric === 'ride' ? '4.0 – 5.0' : '90 – 100', color: CATEGORY_COLORS['Very Good'] },
                      { label: 'Good',      score: colorMetric === 'ride' ? '3.0 – 3.9' : (colorMetric === 'distress' ? '80 – 89' : '70 – 89'), color: CATEGORY_COLORS['Good'] },
                      { label: 'Fair',      score: colorMetric === 'ride' ? '2.0 – 2.9' : (colorMetric === 'distress' ? '70 – 79' : '50 – 69'), color: CATEGORY_COLORS['Fair'] },
                      { label: 'Poor',      score: colorMetric === 'ride' ? '1.0 – 1.9' : (colorMetric === 'distress' ? '60 – 69' : '35 – 49'), color: CATEGORY_COLORS['Poor'] },
                      { label: 'Very Poor', score: colorMetric === 'ride' ? '0.1 – 0.9' : (colorMetric === 'distress' ? '1 – 59'  : '1 – 34'),  color: CATEGORY_COLORS['Very Poor'] },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 12, height: 4, borderRadius: 2, background: item.color }} />
                          <span style={{ fontSize: 11 }}>{item.label}</span>
                        </div>
                        <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{item.score}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Roadbed Mode */}
                {colorMetric === 'roadbed' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 14, height: 4, borderRadius: 2, background: ROADBED_COLORS.R }} />
                      <span>Roadbed R (Inventory)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 14, height: 4, borderRadius: 2, background: ROADBED_COLORS.L }} />
                      <span>Roadbed L (Opposing)</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 14, height: 4, borderRadius: 2, background: ROADBED_COLORS.K }} />
                      <span>Undivided (KG)</span>
                    </div>
                  </div>
                )}

                {/* Slab Thickness Mode */}
                {colorMetric === 'slab' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {[
                      { label: '≥ 12"', color: '#8b5cf6' },
                      { label: '10" – 11.9"', color: '#3b82f6' },
                      { label: '8" – 9.9"', color: '#10b981' },
                      { label: '< 8"', color: '#f59e0b' },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 14, height: 4, borderRadius: 2, background: item.color }} />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Roadbed indicator line */}
                <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: 10, color: '#94a3b8' }}>
                  🟢 Start Point • 🔴 End Point
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {inspectSection && (
        <CoordinateModal
          isOpen={Boolean(inspectSection)}
          section={inspectSection}
          onClose={() => setInspectSection(null)}
          onUpdateSection={updated => {
            if (onUpdateSection) onUpdateSection(updated);
            setInspectSection(updated);
          }}
          addToast={addToast}
        />
      )}

      {isBatchModalOpen && (
        <BatchGpsModal
          isOpen={isBatchModalOpen}
          sections={batchSectionsQueue}
          onClose={() => setIsBatchModalOpen(false)}
          onComplete={handleBatchComplete}
          addToast={addToast}
        />
      )}

      {isGisExportOpen && (
        <GisExportModal
          isOpen={isGisExportOpen}
          sections={sections}
          projectName={project?.name || 'PMIS_Project'}
          onClose={() => setIsGisExportOpen(false)}
          addToast={addToast}
        />
      )}
    </div>
  );
}
