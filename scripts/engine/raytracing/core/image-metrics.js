function validateImages(actual, expected) {
    if (!actual || !expected || actual.length !== expected.length || actual.length % 4 !== 0) {
        throw new Error('Image metrics require equal-length linear RGBA arrays.');
    }
    if (actual.length === 0) throw new Error('Image metrics require at least one pixel.');
}

/** Root-mean-square error over linear RGB channels; alpha is ignored. */
export function linearRgbRmse(actual, expected) {
    validateImages(actual, expected);
    let squaredError = 0;
    for (let offset = 0; offset < actual.length; offset += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
            const difference = actual[offset + channel] - expected[offset + channel];
            squaredError += difference * difference;
        }
    }
    return Math.sqrt(squaredError / (actual.length / 4 * 3));
}

function luminance(data, offset) {
    return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
}

/**
 * Global structural-similarity score over linear luminance.
 * The dynamic range is configurable because path-traced linear output is HDR.
 */
export function linearLuminanceSsim(actual, expected, dynamicRange = 1) {
    validateImages(actual, expected);
    if (!Number.isFinite(dynamicRange) || dynamicRange <= 0) {
        throw new Error('SSIM dynamic range must be positive and finite.');
    }
    const pixelCount = actual.length / 4;
    let actualMean = 0;
    let expectedMean = 0;
    for (let offset = 0; offset < actual.length; offset += 4) {
        actualMean += luminance(actual, offset);
        expectedMean += luminance(expected, offset);
    }
    actualMean /= pixelCount;
    expectedMean /= pixelCount;

    let actualVariance = 0;
    let expectedVariance = 0;
    let covariance = 0;
    for (let offset = 0; offset < actual.length; offset += 4) {
        const actualDelta = luminance(actual, offset) - actualMean;
        const expectedDelta = luminance(expected, offset) - expectedMean;
        actualVariance += actualDelta * actualDelta;
        expectedVariance += expectedDelta * expectedDelta;
        covariance += actualDelta * expectedDelta;
    }
    const divisor = Math.max(1, pixelCount - 1);
    actualVariance /= divisor;
    expectedVariance /= divisor;
    covariance /= divisor;

    const c1 = (0.01 * dynamicRange) ** 2;
    const c2 = (0.03 * dynamicRange) ** 2;
    return (
        (2 * actualMean * expectedMean + c1) * (2 * covariance + c2)
    ) / (
        (actualMean * actualMean + expectedMean * expectedMean + c1)
        * (actualVariance + expectedVariance + c2)
    );
}

export function compareLinearRgba(actual, expected, { dynamicRange } = {}) {
    validateImages(actual, expected);
    let resolvedRange = dynamicRange;
    if (resolvedRange == null) {
        resolvedRange = 1;
        for (let offset = 0; offset < actual.length; offset += 4) {
            resolvedRange = Math.max(
                resolvedRange,
                actual[offset], actual[offset + 1], actual[offset + 2],
                expected[offset], expected[offset + 1], expected[offset + 2],
            );
        }
    }
    return {
        rmse: linearRgbRmse(actual, expected),
        ssim: linearLuminanceSsim(actual, expected, resolvedRange),
        dynamicRange: resolvedRange,
    };
}
