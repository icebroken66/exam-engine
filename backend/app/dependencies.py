"""Stable HTTP dependency callables shared by app assembly and domain routers."""
from .database import get_db
from .model_gateway import ModelGateway


def get_model_gateway() -> ModelGateway:
    return ModelGateway.from_env()
