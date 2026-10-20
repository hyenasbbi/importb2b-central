# Jordan variants: executed 2026-10-20

User authorized L and XL for the five Jordan products in Shores Importados,
subcategory Jordan Dri Fit. Each size: ARS 25,000 cost, ARS 45,000 regular,
ARS 35,000 sale, physical stock 1, minimum 0, empty SKU.

Executed the adjacent SQL in Supabase project jgjvzqfxakvogaeqfual.
Azul Marino already had both correct variants and stock 1, with existing
inventory adjustment records; those IDs and movements were preserved.
Celeste, Blanco Negro Rojo, Blanco Verde, and Verde Agua / Negro / Rojo
had no variants. Created eight variants and eight +1 on_hand adjustments,
reference_type jordan_variants_20261020, with authorization context in notes.
No products, variants, movements or sales were deleted. A transaction-level
comparison confirmed every historical sale item remained identical.

Verification: five products, exactly L/XL per product, ten physical and
available units total, all requested financial/SKU/minimum values correct.
An anonymous HTTP request to importb2b_public_catalog_safe returned all five
products and ten in-stock variants at 45,000 regular / 35,000 sale.
The current origin/main catalog renders sale prices, size selection, and uses
the sale price in the cart; no runtime code or deployment changes were needed.
Visual browser inspection was not performed; production website URL was not
available from repository homepage/deployment metadata.

Do not rerun to replenish inventory. The SQL rejects repetition once its
adjustment marker exists, protecting subsequent sales from accidental restock.
