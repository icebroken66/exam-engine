"""Independent numerical distribution check; no model, database or API calls.

Pair the derivative with Gaussian test functions, rather than checking only t>0.
This finite numerical check supports the fixture; it is not a general proof.
"""
import json
import math


def integral(function, upper=20.0, steps=20000):
    width = upper / steps
    return width / 3 * (function(0) + function(upper) + sum(
        (4 if index % 2 else 2) * function(index * width)
        for index in range(1, steps)))


def check():
    results = []
    for a in (0.5, 1.0, 3.0):
        for b in (0.5, 1.0, 2.0):
            phi = lambda t: math.exp(-b * t * t)
            dphi = lambda t: -2 * b * t * phi(t)
            # Definition: <g', phi> = -<g, phi'>, g=e^(-at)u(t).
            derivative = -integral(lambda t: math.exp(-a * t) * dphi(t))
            ordinary_part = -a * integral(lambda t: math.exp(-a * t) * phi(t))
            with_impulse = phi(0) + ordinary_part
            # Transfer: g=(1-e^(-at))u(t) has no jump, hence no impulse.
            continuous_derivative = -integral(lambda t: (1 - math.exp(-a*t)) * dphi(t))
            continuous_candidate = a * integral(lambda t: math.exp(-a*t) * phi(t))
            error = abs(derivative - with_impulse)
            transfer_error = abs(continuous_derivative - continuous_candidate)
            assert error < 1e-8 and transfer_error < 1e-8
            assert abs(derivative - ordinary_part) > 0.99
            results.append(dict(a=a, b=b, error=error, missing_impulse_error=abs(derivative-ordinary_part), transfer_error=transfer_error))
    return dict(cases=len(results), results=results,
                limit="Finite Gaussian pairings and finite numerical quadrature, not a general proof or model grading.")


if __name__ == "__main__":
    print(json.dumps(check(), indent=2))
