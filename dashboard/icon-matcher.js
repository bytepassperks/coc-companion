(() => {
  const fingerprintCache = fetch("icon-fingerprints.json").then((response) => response.json());
  const unpack = (value) => {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    const result = [];
    for (const byte of bytes) result.push(byte >> 4, byte & 15);
    return result;
  };
  const unpackMask = (value) => {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    return Array.from(bytes).flatMap((byte) => Array.from({ length: 8 }, (_, index) => Boolean(byte & (1 << index))));
  };
  const normalized = (pixels, size) => {
    const result = [];
    for (let channel = 0; channel < 3; channel += 1) {
      const values = [];
      for (let index = channel; index < pixels.length; index += 4) values.push(pixels[index]);
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) || 1;
      result.push(...values.map((value) => Math.max(0, Math.min(15, Math.round(((value - mean) / deviation + 3) * 2.5)))));
    }
    return result;
  };
  const hsvPixels = (pixels, size) => {
    const result = [];
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] / 255, green = pixels[index + 1] / 255, blue = pixels[index + 2] / 255;
      const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue), delta = maximum - minimum;
      let hue = 0;
      if (delta) {
        if (maximum === red) hue = ((green - blue) / delta) % 6;
        else if (maximum === green) hue = (blue - red) / delta + 2;
        else hue = (red - green) / delta + 4;
        hue = Math.round((hue < 0 ? hue + 6 : hue) * 15 / 6) % 16;
      }
      result.push(hue, Math.round((maximum ? delta / maximum : 0) * 15), Math.round(maximum * 15));
    }
    return result;
  };
  const sample = (data, width, height, x, y, region, size = 12) => {
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) {
      const sx = Math.max(0, Math.min(width - 1, Math.round(x + column * (region - 1) / (size - 1))));
      const sy = Math.max(0, Math.min(height - 1, Math.round(y + row * (region - 1) / (size - 1))));
      const source = (sy * width + sx) * 4;
      const target = (row * size + column) * 4;
      pixels[target] = data[source]; pixels[target + 1] = data[source + 1]; pixels[target + 2] = data[source + 2]; pixels[target + 3] = 255;
    }
    return pixels;
  };
  const hsvScore = (left, right, mask) => {
    let error = 0;
    let count = 0;
    for (let pixel = 0; pixel < 144; pixel += 1) {
      if (!mask[pixel]) continue;
      const index = pixel * 3;
      const hueDifference = Math.min(Math.abs(left[index] - right[index]), 16 - Math.abs(left[index] - right[index]));
      error += hueDifference * .8 + Math.abs(left[index + 1] - right[index + 1]) + Math.abs(left[index + 2] - right[index + 2]);
      count += 1;
    }
    return count ? 1 - error / (count * 45) : 0;
  };
  const detectTiles = (data, width, height) => {
    const mask = new Uint8Array(width * height);
    for (let index = 0; index < mask.length; index += 1) {
      const offset = index * 4;
      const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
      mask[index] = blue > 165 && green > 105 && red < 175 && blue > red * 1.18 && green > red * 1.04 ? 1 : 0;
    }
    const seen = new Uint8Array(mask.length);
    const tiles = [];
    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || seen[start]) continue;
      const queue = [start]; seen[start] = 1; let minX = width, minY = height, maxX = 0, maxY = 0, area = 0;
      while (queue.length) {
        const current = queue.pop(); const x = current % width; const y = Math.floor(current / width);
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); area += 1;
        for (const next of [current - 1, current + 1, current - width, current + width]) {
          if (next >= 0 && next < mask.length && !seen[next] && mask[next]) { seen[next] = 1; queue.push(next); }
        }
      }
      const tileWidth = maxX - minX + 1, tileHeight = maxY - minY + 1;
      if (tileWidth >= width * .035 && tileWidth <= width * .25 && tileHeight >= width * .035 && tileHeight <= width * .25 && tileWidth / tileHeight > .45 && tileWidth / tileHeight < 2.1 && area > 120) {
        tiles.push({ x: minX, y: minY, width: tileWidth, height: tileHeight });
      }
    }
    const standard = Math.round(width * .06);
    return tiles.filter((tile, index, all) => !all.some((other, otherIndex) => otherIndex < index && Math.abs(other.x - tile.x) < tile.width * .45 && Math.abs(other.y - tile.y) < tile.height * .45))
      .map((tile) => {
        const size = Math.max(standard, Math.min(Math.max(tile.width, tile.height), Math.round(width * .09)));
        return { x: Math.max(0, Math.round(tile.x + tile.width / 2 - size / 2)), y: Math.max(0, Math.round(tile.y + tile.height / 2 - size / 2)), width: size, height: size };
      })
      .sort((left, right) => left.y - right.y || left.x - right.x);
  };
  window.matchArmyIcons = async (file, rosterNames, maxResults = 24) => {
    const source = await createImageBitmap(file);
    const scale = Math.min(1, 800 / source.width);
    const width = Math.round(source.width * scale);
    const height = Math.round(source.height * scale);
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(source, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const catalog = await fingerprintCache;
    const allowed = new Set(rosterNames);
    const templates = Object.entries(catalog.icons).filter(([name]) => allowed.has(name)).map(([name, value]) => [name, unpack(value.hsv), unpackMask(value.mask)]);
    const detections = [];
    for (const tile of detectTiles(pixels, width, height)) {
      const patchCanvas = new Uint8ClampedArray(12 * 12 * 4);
      const patch = hsvPixels(sample(pixels, width, height, tile.x + tile.width * .18, tile.y + tile.height * .08, tile.width * .7), 12);
      let best; let second = 0; const ranked = [];
      for (const [name, fingerprint, mask] of templates) {
        const current = hsvScore(patch, fingerprint, mask);
        ranked.push({ name, score: current });
        if (!best || current > best.score) { second = best?.score || 0; best = { name, score: current, tile }; }
        else if (current > second) second = current;
      }
      if (best) detections.push({ ...best, margin: best.score - second, alternatives: ranked.sort((left, right) => right.score - left.score).slice(0, 3) });
    }
    detections.sort((left, right) => left.tile.y - right.tile.y || left.tile.x - right.tile.x);
    const rows = [];
    for (const detection of detections) {
      const row = rows.find((candidate) => Math.abs(candidate.y - detection.tile.y) < Math.min(candidate.height, detection.tile.height) * .28);
      if (row) { row.items.push(detection); row.y = (row.y * (row.items.length - 1) + detection.tile.y) / row.items.length; }
      else rows.push({ y: detection.tile.y, height: detection.tile.height, items: [detection] });
    }
    const ordered = rows.sort((left, right) => left.y - right.y).flatMap((row) => row.items.sort((left, right) => left.tile.x - right.tile.x));
    return ordered.slice(0, maxResults).map(({ name, score: confidence, margin, tile, alternatives }) => ({
      name, confidence: Number(confidence.toFixed(3)), confident: confidence >= .72 && margin >= .025,
      x: tile.x, y: tile.y, width: tile.width, height: tile.height,
      alternatives: alternatives.map((item) => ({ name: item.name, score: Number(item.score.toFixed(3)) })),
    }));
  };
})();
