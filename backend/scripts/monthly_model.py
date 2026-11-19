"""Monthly hindcasts and production forecasts share the same recursive prediction path."""
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor

VERSION = "v3.0"
INDICES = {"tvdi": ("TVDI", 0., 1.), "lst": ("LST_C", 18., 55.), "ndvi": ("NDVI", -.25, .98)}
FEATURES = ["lag1", "lag2", "lag3", "lag12", "roll3", "c_smean", "sin_m", "cos_m", "lon", "lat"]


def load_monthly(csv):
    grid = pd.read_csv(csv, parse_dates=["date"])
    grid["date"] = grid.date.dt.to_period("M").dt.to_timestamp()
    for col, low, high in INDICES.values():
        grid[col] = grid[col].where(grid[col].between(low, high))
    return grid.groupby(["date", "cell_id"], as_index=False).agg(
        lon=("lon", "first"), lat=("lat", "first"), TVDI=("TVDI", "mean"),
        LST_C=("LST_C", "mean"), NDVI=("NDVI", "mean"))


def seasonal(history, months):
    """Pool the same and adjacent calendar months, shrinking sparse cells toward the regional cycle."""
    valid = np.isfinite(history)
    sums = np.array([np.nansum(history[months == m], axis=0) for m in range(1, 13)])
    counts = np.array([valid[months == m].sum(axis=0) for m in range(1, 13)])
    region = sums.sum(axis=1) / np.maximum(counts.sum(axis=1), 1)
    cell_mean = (sums.sum(axis=0) + np.nanmean(history)) / (counts.sum(axis=0) + 1)
    prior = cell_mean + (region - np.nanmean(history))[:, None]
    def smooth(x):
        return x + .5 * (np.roll(x, 1, axis=0) + np.roll(x, -1, axis=0))
    return (smooth(sums) + 4 * prior) / (smooth(counts) + 4)


def features(history, month, cycle, coords):
    lags = []
    for lag in (1, 2, 3, 12):
        obs = history[-lag]
        lags.append(np.where(np.isfinite(obs), obs, cycle[(month - lag - 1) % 12]))
    angle = 2 * np.pi * month / 12
    return np.column_stack([*lags, np.mean(lags[:3], axis=0), cycle[month - 1],
                            np.full(len(coords), np.sin(angle)), np.full(len(coords), np.cos(angle)), coords])


def regional_cycle(history, months, window, amplitude):
    # Estimate a smooth regional seasonal cycle from available monthly means.
    series = np.nanmean(history[-window:], axis=1)
    def harmonics(m):
        angle = m * 2 * np.pi / 12
        return np.column_stack([np.ones(len(m)), np.sin(angle), np.cos(angle),
                                np.sin(2*angle), np.cos(2*angle)])
    observed = np.isfinite(series)
    basis = harmonics(months[-window:])[observed]
    coef = np.linalg.lstsq(basis, series[observed], rcond=None)[0]
    coef[1:] *= amplitude
    return harmonics(np.arange(1, 13)) @ coef


def select_regional_cycle(y, dates, months):
    starts = [dates.get_loc(s) for s in pd.date_range("2022-01-01", "2023-01-01", freq="MS")]
    def validation_loss(params):
        errors = []
        for i in starts:
            pred = regional_cycle(y[:i], months[:i], *params)[months[i:i+12] - 1]
            errors.extend((np.nanmean(y[i:i+12], axis=1) - pred) ** 2)
        return np.nanmean(errors)
    return min(((w, a) for w in (24, 36, 60, 120) for a in (0., .5, 1.)), key=validation_loss)


def forecast(model, history, months, coords, steps, bounds, weight, regional=None):
    cycle = seasonal(history, months)
    region = regional_cycle(history, months, *regional) if regional else None
    path = list(history)
    for step in range(steps):
        month = (months[-1] + step) % 12 + 1
        x = features(path, month, cycle, coords)
        value = np.clip(weight * model.predict(x) + (1 - weight) * cycle[month - 1], *bounds)
        if region is not None:
            value = np.clip(value + region[month - 1] - value.mean(), *bounds)
        path.append(value)
    return np.stack(path[-steps:])


def scores(actual, pred):
    keep = np.isfinite(actual) & np.isfinite(pred)
    y, p = actual[keep], pred[keep]
    if not len(y):
        return dict(r2_score=None, rmse=None, mae=None, test_samples=0)
    delta = p - y
    var = np.sum((y - y.mean()) ** 2)
    return dict(r2_score=round(float(1 - np.sum(delta ** 2) / var), 4) if var > 0 else None,
                rmse=round(float(np.sqrt(np.mean(delta ** 2))), 4),
                mae=round(float(np.mean(np.abs(delta))), 4), test_samples=len(y))


def evaluate(actual, pred):
    # Compare regional means on exactly the same observed cells at each origin and target month.
    valid = np.isfinite(actual)
    counts = valid.sum(axis=-1)
    def regional(values):
        return np.nansum(np.where(valid, values, np.nan), axis=-1) / np.where(counts, counts, np.nan)
    return {"grid": scores(actual, pred), "overall": scores(regional(actual), regional(pred))}


def train_index(monthly, key, future_months):
    col, lo, hi = INDICES[key]
    values = monthly.pivot(index="date", columns="cell_id", values=col)
    dates = pd.date_range(values.index.min(), values.index.max(), freq="MS")
    values = values.reindex(dates)
    cells = values.columns
    coords = monthly.drop_duplicates("cell_id").set_index("cell_id").loc[cells, ["lon", "lat"]].to_numpy()
    y, months = values.to_numpy(), dates.month.to_numpy()
    # Construct each historical feature row with only observations known before that month.
    xs, ys = [], []
    for i in range(12, len(dates)):
        cycle = seasonal(y[:i], months[:i])
        observed = np.isfinite(y[i])
        xs.append(features(y[:i], months[i], cycle, coords)[observed])
        ys.append(y[i, observed])

    def fit(stop):
        model = RandomForestRegressor(n_estimators=48, min_samples_leaf=16, max_features=.8,
                                      max_depth=12, n_jobs=2, random_state=42)
        return model.fit(np.concatenate(xs[:stop-12]), np.concatenate(ys[:stop-12]))

    regional = select_regional_cycle(y, dates, months) if key == "tvdi" else None

    def hindcasts(starts, weights):
        actual, predictions, naive = [], {w: [] for w in weights}, []
        for start in starts:
            stop = dates.get_loc(start)
            history = y[:stop]
            model = fit(stop)
            actual.append(y[stop:stop+12])
            cycle = seasonal(history, months[:stop])
            prev = history[-12:]
            naive.append(np.where(np.isfinite(prev), prev, cycle[months[stop:stop+12] - 1]))
            for weight in weights:
                predictions[weight].append(forecast(model, history, months[:stop], coords, 12, (lo, hi), weight, regional if weight < 1 else None))
        return np.stack(actual), {w: np.stack(p) for w, p in predictions.items()}, np.stack(naive)

    weight = 1.
    if key == "tvdi":
        # Select on 2022–23 only. Score both spatial and regional RMSE relative to the unblended RF.
        choices = (.2, .55, 1.)
        obs, candidates, _ = hindcasts(pd.date_range("2022-01-01", "2023-01-01", freq="3MS"), choices)
        stats = {w: evaluate(obs, p) for w, p in candidates.items()}
        weight = min(choices, key=lambda w: sum(stats[w][s]["rmse"] / stats[1.][s]["rmse"]
                                                  for s in ("grid", "overall")))

    starts = pd.date_range("2024-01-01", "2025-01-01", freq="MS")
    actual, candidates, naive = hindcasts(starts, sorted({weight, 1.}))
    pred = candidates[weight]
    summary = evaluate(actual, pred)
    summary["by_lead"] = [dict(lead=h+1, **evaluate(actual[:, h], pred[:, h])) for h in range(12)]
    summary["seasonal_naive"] = evaluate(actual, naive)
    if key == "tvdi":
        summary["plain_rf"] = evaluate(actual, candidates[1.])
    summary["rf_weight"] = weight
    calibration = regional if weight < 1 else None
    summary["regional_cycle"] = calibration

    model = fit(len(dates))
    steps = [pd.Period(d, freq="M").ordinal - dates[-1].to_period("M").ordinal for d in future_months]
    if min(steps) < 1:
        raise ValueError("Các tháng dự báo phải sau kỳ quan trắc gần nhất.")
    future = forecast(model, y, months, coords, max(steps), (lo, hi), weight, calibration)
    return {
        "model": {"version": VERSION, "forest": model, "rf_weight": weight, "regional_cycle": calibration, "features": FEATURES},
        "grid_metrics": summary["grid"], "overall_metrics": summary["overall"], "evaluation": summary,
        "feature_importances": [dict(feature=k, importance_percent=round(float(v)*100, 2))
                                for k, v in sorted(zip(FEATURES, model.feature_importances_), key=lambda t: -t[1])],
        "cell_preds_by_date": {dt: dict(zip(cells.astype(int), future[n-1])) for dt, n in zip(future_months, steps)}
    }


def monthly_evaluation(results, monthly):
    return {
        "version": VERSION, "last_observation": monthly.date.max().date().isoformat(),
        "first_target": "2024-01", "last_target": "2025-12", "origins": 13,
        "indices": {k: res["evaluation"] for k, res in results.items()}
    }
